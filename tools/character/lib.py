"""Shared helpers for TABLETOP character concepts (headless Blender 5.x).
Blender axes: Z up, -Y is the character's front (glTF +Z toward camera).
Character's left (.L) is +X."""
import bpy, bmesh, math, sys, os, json, struct
from mathutils import Vector, Matrix, Euler

D = bpy.data
R = math.radians
MATS = {}
COLL = [None]


def ctx():
    return bpy.context


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    sc = ctx().scene
    sc.render.fps = 30
    c = D.collections.new('chars'); sc.collection.children.link(c); COLL[0] = c


def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def mat(name, col, rough=0.5, metal=0.0, sss=0.0, sheen=0.0, coat=0.0, spec=0.5):
    if name in MATS: return MATS[name]
    m = D.materials.new(name)
    b = [n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    rgb = lin(col) if isinstance(col, str) else col
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Specular IOR Level'].default_value = spec
    if sss:
        b.inputs['Subsurface Weight'].default_value = sss
        b.inputs['Subsurface Scale'].default_value = 0.04
        b.inputs['Subsurface Radius'].default_value = (1.0, 0.45, 0.3)
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen
        b.inputs['Sheen Roughness'].default_value = 0.4
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.08
    m.diffuse_color = (*rgb, 1)
    MATS[name] = m
    return m


# ------------------------------------------------------------------ meshes
def obj_from_bm(name, bm, m, bone='AUTO', smooth=True, sharp=None):
    me = D.meshes.new(name); bm.normal_update(); bm.to_mesh(me); bm.free()
    if smooth: me.shade_smooth()
    if sharp: me.set_sharp_from_angle(angle=R(sharp))
    o = D.objects.new(name, me); COLL[0].objects.link(o)
    me.materials.append(m); o['bone'] = bone
    return o


def mtx(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return (Matrix.Translation(loc) @ Euler([R(a) for a in rot]).to_matrix().to_4x4()
            @ Matrix.Diagonal((*scale, 1)))


def xform(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    bmesh.ops.transform(bm, matrix=mtx(loc, rot, scale), verts=bm.verts)


def ellipsoid(name, m, r, loc, scale=(1, 1, 1), rot=(0, 0, 0), seg=16, rings=10, bone='AUTO', cut=None, M=None):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    if cut is not None:  # keep the part above z = cut*r
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                                     plane_co=(0, 0, cut * r), plane_no=(0, 0, 1), clear_inner=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    xform(bm, (0, 0, 0), (0, 0, 0), scale)
    xform(bm, loc, rot)
    if M is not None: bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return obj_from_bm(name, bm, m, bone)


def smooth_pts(pts, n=3):
    """Catmull-Rom densify a list of 2D points (endpoints kept)."""
    P = [pts[0]] + list(pts) + [pts[-1]]; out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = [Vector(P[j]) for j in (i - 1, i, i + 1, i + 2)]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(Vector(pts[-1]))
    res = [(v.x, v.y) for v in out]
    res = [(0.0 if (i in (0, len(res) - 1) and pts[0 if i == 0 else -1][0] == 0) else max(0.004, r), z)
           for i, (r, z) in enumerate(res)]
    return res


def lathe_bm(prof, seg):
    bm = bmesh.new(); rings = []
    for r, z in prof:
        if r < 1e-5: rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg + math.pi / 2),
                                        r * math.sin(2 * math.pi * i / seg + math.pi / 2), z)) for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1: continue
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1: bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1: bm.faces.new((a[i], a[j], b[0]))
            else: bm.faces.new((a[i], a[j], b[j], b[i]))
    for ring in (rings[0], rings[-1]):
        if len(ring) > 1: bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


class Lathe:
    """A lathed body that knows its own surface (for placing face parts)."""
    def __init__(self, name, m, ctrl, seg=24, sy=1.0, sx=1.0, loc=(0, 0, 0), bone='AUTO', n=3, sharp=None):
        self.prof = smooth_pts(ctrl, n) if n > 1 else list(ctrl)
        self.sy, self.sx, self.loc = sy, sx, Vector(loc)
        bm = lathe_bm(self.prof, seg); xform(bm, loc, (0, 0, 0), (sx, sy, 1))
        self.obj = obj_from_bm(name, bm, m, bone, sharp=sharp)

    def r_at(self, z):
        z -= self.loc.z; p = self.prof; best = 0
        for (r1, z1), (r2, z2) in zip(p, p[1:]):
            if min(z1, z2) <= z <= max(z1, z2) and z1 != z2:
                best = max(best, r1 + (r2 - r1) * (z - z1) / (z2 - z1))
        return best

    def surf(self, z, th, off=0.0):
        """Point on the surface at height z, angle th (rad, 0 = front, + toward +X)."""
        r = self.r_at(z) + off
        return Vector((self.loc.x + r * self.sx * math.sin(th), self.loc.y - r * self.sy * math.cos(th), z))

    def normal(self, z, th):
        e = 0.01
        dr = (self.r_at(z + e) - self.r_at(z - e)) / (2 * e)
        n = Vector((math.sin(th) / self.sx, -math.cos(th) / self.sy, -dr))
        return n.normalized()


def lathe(name, m, ctrl, seg=16, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), bone='AUTO', n=1, sharp=None, M=None):
    prof = smooth_pts(ctrl, n) if n > 1 else ctrl
    bm = lathe_bm(prof, seg); xform(bm, (0, 0, 0), (0, 0, 0), scale); xform(bm, loc, rot)
    if M is not None: bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return obj_from_bm(name, bm, m, bone, sharp=sharp)


def rcyl(name, m, r, h, b=0.02, loc=(0, 0, 0), rot=(0, 0, 0), seg=16, bone='AUTO', r2=None, M=None):
    """Rounded cylinder, base centre at loc (before rot)."""
    r2 = r if r2 is None else r2
    prof = [(0, 0)]
    for k in range(4):
        a = k / 3 * math.pi / 2
        prof.append((r - b + b * math.sin(a), b - b * math.cos(a)))
    for k in range(4):
        a = k / 3 * math.pi / 2
        prof.append((r2 - b + b * math.cos(a), h - b + b * math.sin(a)))
    prof.append((0, h))
    return lathe(name, m, prof, seg, loc, rot, bone=bone, sharp=50, M=M)


def capsule(name, m, p1, p2, r1, r2, seg=12, bone='AUTO', n=4):
    p1, p2 = Vector(p1), Vector(p2); d = p2 - p1; L = d.length
    prof = [(r1 * math.sin(a), -r1 * math.cos(a)) for a in [i / n * math.pi / 2 for i in range(n + 1)]]
    prof += [(r2 * math.cos(a), L + r2 * math.sin(a)) for a in [i / n * math.pi / 2 for i in range(n + 1)]]
    bm = lathe_bm(prof, seg)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation(p1) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return obj_from_bm(name, bm, m, bone)


def tube(name, m, path, r, seg=8, closed=False, bone='AUTO', caps=True):
    pts = [Vector(p) for p in path]; n = len(pts)
    rs = r if isinstance(r, (list, tuple)) else [r] * n
    tans = []
    for i in range(n):
        if closed: t = pts[(i + 1) % n] - pts[i - 1]
        else: t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tans.append(t.normalized())
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tans[0].cross(ref).normalized()
    bm = bmesh.new(); rings = []
    for i in range(n):
        t = tans[i]; nrm = (nrm - t * nrm.dot(t)).normalized(); b = t.cross(nrm)
        rings.append([bm.verts.new(pts[i] + rs[i] * (math.cos(2 * math.pi * k / seg) * nrm
                                                    + math.sin(2 * math.pi * k / seg) * b)) for k in range(seg)])
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for a, c in pairs:
        for k in range(seg):
            j = (k + 1) % seg; bm.faces.new((a[k], a[j], c[j], c[k]))
    if not closed and caps:
        for ring, p, t in ((rings[0], pts[0] - tans[0] * rs[0] * 0.7, None), (rings[-1], pts[-1] + tans[-1] * rs[-1] * 0.7, None)):
            c = bm.verts.new(p)
            for k in range(seg): bm.faces.new((ring[k], ring[(k + 1) % seg], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, m, bone)


def apply_mods(o):
    dg = ctx().evaluated_depsgraph_get()
    me = D.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data; o.modifiers.clear(); o.data = me; D.meshes.remove(old)
    return o


def outline_ellipse(w, h):
    return lambda p: (w / 2 * math.cos(p), h / 2 * math.sin(p))


def outline_D(w, h, top=0.15):
    return lambda p: (w / 2 * math.cos(p), (h * top if math.sin(p) > 0 else h) * math.sin(p))


def outline_star(R_, r_, pts=5):
    def f(p):
        a = (p - math.pi / 2) % (2 * math.pi / pts) / (2 * math.pi / pts)
        rad = R_ + (r_ - R_) * (1 - abs(1 - 2 * a))
        return (rad * math.cos(p), rad * math.sin(p))
    return f


def outline_rrect(w, h, rr=0.3):
    def f(p):
        c, s = math.cos(p), math.sin(p); e = 2 / max(rr, 0.05)
        k = (abs(c) ** e + abs(s) ** e) ** (-1 / e)
        return (w / 2 * c * k, h / 2 * s * k)
    return f


def decal(name, m, target, center, th, outline, tilt=0.0, N=24, K=3, thick=0.012, off=0.002,
          bone='AUTO', shift=(0, 0)):
    """A sticker conformed to `target` with shrinkwrap, then solidified outward."""
    bm = bmesh.new(); c = bm.verts.new((shift[0], 0, shift[1])); rings = []
    for k in range(1, K + 1):
        f = k / K
        rings.append([bm.verts.new((shift[0] + u * f, 0, shift[1] + v * f))
                      for (u, v) in [outline(2 * math.pi * i / N) for i in range(N)]])
    for i in range(N):
        j = (i + 1) % N; bm.faces.new((c, rings[0][i], rings[0][j]))
        for a, b in zip(rings, rings[1:]): bm.faces.new((a[i], b[i], b[j], a[j]))
    q = Euler((R(tilt), 0, th)).to_matrix().to_4x4()
    nvec = Vector((math.sin(th), -math.cos(th), 0))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center) + nvec * 0.04) @ q, verts=bm.verts)
    o = obj_from_bm(name, bm, m, bone, smooth=False)
    sw = o.modifiers.new('sw', 'SHRINKWRAP'); sw.target = target
    sw.wrap_method = 'NEAREST_SURFACEPOINT'; sw.wrap_mode = 'ABOVE_SURFACE'; sw.offset = off
    so = o.modifiers.new('so', 'SOLIDIFY'); so.thickness = thick; so.offset = 1.0
    apply_mods(o); o.data.shade_smooth(); o.data.set_sharp_from_angle(angle=R(40))
    return o


def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    ctx().view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = ctx().view_layer.objects.active; o.name = name; o.data.name = name
    return o


# ------------------------------------------------------------------ hats
def hat(kind, top, head_r, sink=None, tilt=(0, 0, 0), fwd=0.0):
    """Builds accessory parts (base at origin, sized for a head radius of 0.4) and
    places them on top of a head whose top is at z=top."""
    s = head_r / 0.4
    parts = []
    W = mat('acc_white', '#fbf7f0', 0.45)
    if kind == 'party':
        m = mat('acc_party', '#ff5d8f', 0.45); st = mat('acc_party2', '#ffe066', 0.45)
        parts.append(lathe('party', m, [(0.17, 0), (0.12, 0.13), (0.065, 0.26), (0.0, 0.40)], 16))
        parts.append(tube('party_s1', st, [(0.143 * math.cos(a), 0.143 * math.sin(a), 0.07) for a in [i / 16 * 2 * math.pi for i in range(16)]], 0.018, 6, True))
        parts.append(tube('party_s2', st, [(0.093 * math.cos(a), 0.093 * math.sin(a), 0.20) for a in [i / 16 * 2 * math.pi for i in range(16)]], 0.016, 6, True))
        parts.append(ellipsoid('party_pom', W, 0.06, (0, 0, 0.41), seg=10, rings=6))
        sink = 0.05 if sink is None else sink
    elif kind == 'propeller':
        m = mat('acc_prop', '#8f6bff', 0.5); bl = mat('acc_blade', '#ffd23f', 0.4); st = mat('acc_prop2', '#ff5d8f', 0.4)
        parts.append(ellipsoid('cap', m, 0.26, (0, 0, 0), (1, 1, 0.62), seg=14, rings=8, cut=0.0))
        parts.append(ellipsoid('brim', m, 0.17, (0, -0.2, 0.012), (1, 0.85, 0.12), seg=14, rings=6))
        parts.append(rcyl('stem', st, 0.022, 0.12, 0.008, (0, 0, 0.14), seg=8))
        parts.append(ellipsoid('hub', st, 0.04, (0, 0, 0.27), seg=10, rings=6))
        for sgn in (-1, 1):
            parts.append(ellipsoid('blade', bl, 0.16, (sgn * 0.16, 0, 0.27), (1, 0.32, 0.08), rot=(0, sgn * 10, 0), seg=12, rings=6))
        sink = 0.07 if sink is None else sink
    elif kind == 'crown':
        g = mat('acc_gold', '#ffc23d', 0.28, metal=0.7); gem = mat('acc_gem', '#e63950', 0.15)
        parts.append(lathe('band', g, [(0.2, 0.0), (0.215, 0.012), (0.215, 0.09), (0.2, 0.1), (0.18, 0.1), (0.18, 0.0)], 15, sharp=50))
        for i in range(5):
            a = i / 5 * 2 * math.pi + math.pi / 2
            x, y = 0.2 * math.cos(a), 0.2 * math.sin(a)
            parts.append(lathe('spike', g, [(0.06, 0), (0.035, 0.07), (0.0, 0.13)], 6, loc=(x, y, 0.07)))
            parts.append(ellipsoid('ball', g, 0.028, (x, y, 0.205), seg=6, rings=4))
        parts.append(ellipsoid('gem', gem, 0.04, (0, -0.215, 0.05), (1, 0.5, 1.2), seg=10, rings=6))
        sink = 0.08 if sink is None else sink
    elif kind == 'tophat':
        m = mat('acc_top', '#2b2d42', 0.4); band = mat('acc_band', '#ff5d5d', 0.5)
        parts.append(rcyl('brim', m, 0.27, 0.03, 0.012, (0, 0, 0), seg=16))
        parts.append(rcyl('crown', m, 0.165, 0.30, 0.03, (0, 0, 0.01), seg=14, r2=0.18))
        parts.append(rcyl('band', band, 0.172, 0.06, 0.01, (0, 0, 0.035), seg=14))
        sink = 0.03 if sink is None else sink
    elif kind == 'bow':
        m = mat('acc_bow', '#ff6fae', 0.45)
        for sg in (-1, 1):
            parts.append(ellipsoid('loop', m, 0.12, (sg * 0.11, 0, 0.06), (1, 0.55, 0.75), rot=(0, sg * -18, 0), seg=12, rings=8))
        parts.append(ellipsoid('knot', m, 0.055, (0, 0, 0.06), (1, 0.8, 1), seg=10, rings=6))
        sink = 0.03 if sink is None else sink
    elif kind == 'sprout':
        st = mat('acc_stem', '#4caf50', 0.5); lf = mat('acc_leaf', '#7ddc6f', 0.45)
        parts.append(tube('stem', st, [(0, 0, -0.02), (0, 0, 0.08), (0.01, 0, 0.16)], 0.022, 8))
        for sg in (-1, 1):
            parts.append(ellipsoid('leaf', lf, 0.11, (sg * 0.1, 0, 0.19), (1, 0.55, 0.16), rot=(0, sg * -25, 0), seg=12, rings=6))
        sink = 0.0 if sink is None else sink
    elif kind == 'beanie':
        m = mat('acc_beanie', '#fff1d6', 0.85, sheen=0.5); rib = mat('acc_beanie2', '#ff7b54', 0.85, sheen=0.5)
        parts.append(ellipsoid('cap', m, 0.33, (0, 0, 0), (1, 1, 0.75), seg=18, rings=10, cut=0.0))
        parts.append(lathe('fold', rib, [(0.32, -0.02), (0.345, 0.0), (0.35, 0.05), (0.345, 0.09), (0.31, 0.11), (0.3, -0.02)], 20, n=1))
        parts.append(ellipsoid('pom', rib, 0.08, (0, 0, 0.26), seg=10, rings=6))
        sink = 0.2 if sink is None else sink
    o = join(parts, 'acc_' + kind)
    M = (Matrix.Translation((0, fwd, top - sink * s)) @ Euler([R(a) for a in tilt]).to_matrix().to_4x4()
         @ Matrix.Diagonal((s, s, s, 1)))
    o.data.transform(M)
    return o


# ------------------------------------------------------------------ rig
def std_bones(d):
    """d: dict of joint positions (x,z for L side; mirrored)."""
    B = [('root', (0, 0, 0), (0, 0, d['root']), None, (0, -1, 0)),
         ('spine', (0, 0, d['spine'][0]), (0, 0, d['spine'][1]), 'root', (0, -1, 0)),
         ('head', (0, 0, d['spine'][1]), (0, 0, d['head']), 'spine', (0, -1, 0))]
    for s, n in ((1, 'L'), (-1, 'R')):
        sh, el, wr = d['shoulder'], d['elbow'], d['wrist']
        hp, kn, an = d['hip'], d['knee'], d['ankle']
        B += [('upperarm.' + n, (s * sh[0], 0, sh[1]), (s * el[0], 0, el[1]), 'spine', (0, -1, 0)),
              ('forearm.' + n, (s * el[0], 0, el[1]), (s * wr[0], 0, wr[1]), 'upperarm.' + n, (0, -1, 0)),
              ] + ([('hand.' + n, (s * wr[0], 0, wr[1]), (s * d['hand'][0], 0, d['hand'][1]), 'forearm.' + n, (0, -1, 0))] if 'hand' in d else []) + [
              ('thigh.' + n, (s * hp[0], 0, hp[1]), (s * kn[0], 0, kn[1]), 'root', (0, -1, 0)),
              ('shin.' + n, (s * kn[0], 0, kn[1]), (s * an[0], 0, an[1]), 'thigh.' + n, (0, -1, 0)),
              ('foot.' + n, (s * an[0], 0, an[1]), (s * an[0], d['toe'][0], d['toe'][1]), 'shin.' + n, (0, 0, 1))]
    return B


def make_armature(name, bones):
    ad = D.armatures.new(name); ao = D.objects.new(name, ad); COLL[0].objects.link(ao)
    bpy.ops.object.select_all(action='DESELECT'); ao.select_set(True)
    ctx().view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode='EDIT')
    for bn, h, t, par, rv in bones:
        eb = ad.edit_bones.new(bn); eb.head = h; eb.tail = t; eb.align_roll(Vector(rv))
        if par: eb.parent = ad.edit_bones[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ao


def seg_dist(p, a, b):
    ab = b - a; t = max(0, min(1, (p - a).dot(ab) / ab.length_squared)); return (a + ab * t - p).length


def heat(arm, o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); arm.select_set(True)
    ctx().view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def xfer(src, o):
    """Copy skin weights from src's nearest surface onto o (for stickers/seams)."""
    names = [g.name for g in src.vertex_groups]
    for n in names:
        if n not in o.vertex_groups: o.vertex_groups.new(name=n)
    sv = src.data.vertices
    for v in o.data.vertices:
        ok, loc, nor, fi = src.closest_point_on_mesh(v.co)
        if not ok: continue
        acc = {}; tot = 0
        for vi in src.data.polygons[fi].vertices:
            w = 1 / max((sv[vi].co - loc).length, 1e-4); tot += w
            for g in sv[vi].groups: acc[g.group] = acc.get(g.group, 0) + w * g.weight
        for gi, w in acc.items():
            if w / tot > 1e-3: o.vertex_groups[names[gi]].add([v.index], w / tot, 'REPLACE')


def restrict(o, keep, dump):
    """Fold weights of bones not in `keep` into `dump` (stops arm bones dragging the torso)."""
    names = {g.index: g.name for g in o.vertex_groups}
    if dump not in o.vertex_groups: o.vertex_groups.new(name=dump)
    dg = o.vertex_groups[dump]
    for v in o.data.vertices:
        extra = 0
        for g in list(v.groups):
            if names.get(g.group) not in keep:
                extra += g.weight; o.vertex_groups[names[g.group]].remove([v.index])
        if extra > 0:
            cur = 0
            for g in v.groups:
                if g.group == dg.index: cur = g.weight
            dg.add([v.index], cur + extra, 'REPLACE')


CUSTOM = {}      # object name -> fn(arm, obj) that writes the object's own skin weights


def assemble(arm, parts, name):
    custom = [p for p in parts if p['bone'] == 'CUSTOM']
    auto = [p for p in parts if p['bone'] == 'AUTO']
    xf = [p for p in parts if p['bone'] == 'XFER']
    rigid = [p for p in parts if p['bone'] not in ('AUTO', 'XFER', 'CUSTOM')]
    for p in custom: CUSTOM[p.name](arm, p)
    for p in auto:
        heat(arm, p)
        if 'keep' in p: restrict(p, p['keep'].split(','), p.get('dump', 'spine'))
    for p in xf: xfer((custom + auto)[0], p)
    for p in rigid:
        vg = p.vertex_groups.new(name=p['bone']); vg.add(list(range(len(p.data.vertices))), 1.0, 'REPLACE')
    skin = join(custom + auto + xf + rigid, name)
    if not any(m.type == 'ARMATURE' for m in skin.modifiers):
        bpy.ops.object.select_all(action='DESELECT'); skin.select_set(True); arm.select_set(True)
        ctx().view_layer.objects.active = arm
        bpy.ops.object.parent_set(type='ARMATURE')
    bones = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones if b.name != 'root'}
    missed = 0
    for v in skin.data.vertices:
        if sum(g.weight for g in v.groups) < 1e-3:
            bn = min(bones, key=lambda k: seg_dist(v.co, *bones[k]))
            if bn not in skin.vertex_groups: skin.vertex_groups.new(name=bn)
            skin.vertex_groups[bn].add([v.index], 1.0, 'REPLACE'); missed += 1
    print(name, 'heat-missed verts:', missed, '/', len(skin.data.vertices))
    return skin


def parent_bone(o, arm, bn):
    ctx().view_layer.update()
    pb = arm.pose.bones[bn]
    o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = bn
    o.matrix_parent_inverse = (arm.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.bone.length, 0))).inverted()


# ------------------------------------------------------------------ poses
def lr(d, bn, s, r):
    d[bn + ('.L' if s > 0 else '.R')] = {'r': (r[0], r[1] * s, r[2] * s)}


def pose_idle(t, A):
    p = 2 * math.pi * t; b = math.sin(p); d = {}
    d['root'] = {'l': (0, 0, 0)}
    d['spine'] = {'r': (2 * b, 0, 0), 's': (1 + 0.015 * b, 1 - 0.025 * b, 1 + 0.015 * b)}
    d['head'] = {'r': (-2 * b, 0, 3 * math.sin(p + 1))}
    for s in (1, -1):
        lr(d, 'upperarm', s, (4 * math.sin(p + s), 0, 6 + 4 * b))
        lr(d, 'forearm', s, (12 + 4 * b, 0, 0))
    return d


def pose_run(t, A):
    p = 2 * math.pi * t; d = {}
    d['root'] = {'l': (0, A['bob'] * (1 - math.cos(2 * p)) / 2, 0), 'r': (0, 6 * math.sin(p), 0)}
    d['spine'] = {'r': (14, -6 * math.sin(p), 0), 's': (1, 1 - 0.04 * math.cos(2 * p), 1)}
    d['head'] = {'r': (-8, 0, 3 * math.sin(p))}
    for s in (1, -1):
        ph = p if s > 0 else p + math.pi
        lr(d, 'thigh', s, (A['leg'] * math.sin(ph), 0, 4))
        lr(d, 'shin', s, (-A['leg'] * 0.9 * (1 - math.sin(ph + 0.6)) / 2 - 8, 0, 0))
        lr(d, 'foot', s, (12 * math.sin(ph), 0, 0))
        lr(d, 'upperarm', s, (-A['arm'] * math.sin(ph), 0, 28 + 10 * math.cos(ph)))
        lr(d, 'forearm', s, (55, 0, 0))
    return d


def pose_jump(t, A):
    p = 2 * math.pi * t * 2; d = {}
    d['root'] = {'l': (0, 0, 0)}
    d['spine'] = {'r': (-10, 0, 4 * math.sin(p / 2)), 's': (0.97, 1.05, 0.97)}
    d['head'] = {'r': (-12, 0, 6 * math.sin(p / 2 + 1))}
    for s in (1, -1):
        ph = p if s > 0 else p + 2.2
        lr(d, 'upperarm', s, (25 * math.sin(ph), 0, A['flail'] + 28 * math.sin(ph + 1)))
        lr(d, 'forearm', s, (35 + 25 * math.sin(ph + 0.5), 0, 0))
        lr(d, 'thigh', s, (30 + 30 * math.sin(ph * 0.5 + (0 if s > 0 else math.pi)), 0, 10))
        lr(d, 'shin', s, (-45 - 20 * math.sin(ph * 0.5), 0, 0))
        lr(d, 'foot', s, (-10, 0, 0))
    return d


def pose_tumble(t, A):
    p = 2 * math.pi * t; d = {}
    d['root'] = {'l': (0, 0, 0)}
    d['spine'] = {'r': (18 + 6 * math.sin(p), 0, 8 * math.sin(p + 1))}
    d['head'] = {'r': (14, 10 * math.sin(p), 6 * math.sin(p + 2))}
    for s in (1, -1):
        ph = p + (0 if s > 0 else 1.7)
        lr(d, 'upperarm', s, (15 * math.sin(ph), 0, A['splay'] + 12 * math.sin(ph + 1)))
        lr(d, 'forearm', s, (25 + 15 * math.sin(ph), 0, 0))
        lr(d, 'thigh', s, (35 + 15 * math.sin(ph), 0, 32))
        lr(d, 'shin', s, (-35 - 10 * math.sin(ph), 0, 0))
        lr(d, 'foot', s, (15, 0, 0))
    return d


POSES = {'idle': (pose_idle, 36), 'run': (pose_run, 16), 'jump': (pose_jump, 24), 'tumble': (pose_tumble, 30)}
AMP = {'bob': 0.06, 'leg': 45, 'arm': 55, 'flail': 115, 'splay': 80}


def apply_pose(arm, d):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    for bn, v in d.items():
        if bn not in arm.pose.bones: continue
        pb = arm.pose.bones[bn]
        if 'r' in v: pb.rotation_euler = [R(a) for a in v['r']]
        if 'l' in v: pb.location = v['l']
        if 's' in v: pb.scale = v['s']


def make_actions(arm, A):
    ad = arm.animation_data_create()
    for name, (fn, n) in POSES.items():
        act = D.actions.new(name); act.use_fake_user = True; ad.action = act
        for f in range(0, n + 1, 2):
            apply_pose(arm, fn((f % n) / n, A))
            for pb in arm.pose.bones:
                pb.keyframe_insert('rotation_euler', frame=f + 1)
                pb.keyframe_insert('location', frame=f + 1)
                pb.keyframe_insert('scale', frame=f + 1)
        ad.action = None
        tr = ad.nla_tracks.new(); tr.name = name; tr.strips.new(name, 1, act); tr.mute = True
    apply_pose(arm, {})


# ------------------------------------------------------------------ build + export
def build(cfg, color, hats, name, body_name, loc=(0, 0, 0), rot=(0, 0, 0)):
    body = mat(body_name, color, **cfg.BODY_MAT)
    c = lin(color); t = getattr(cfg, 'TINT', 0.42)
    tint_rgb = tuple(lin('#ffffff')[k] * t + c[k] * (1 - t) for k in range(3))
    tint = mat(body_name + '_tint', tint_rgb, **cfg.BODY_MAT)
    parts = cfg.parts(body, tint)
    arm = make_armature(name + '_rig', std_bones(cfg.JOINTS))
    skin = assemble(arm, parts, name + '_mesh')
    acc = []
    for k in hats:
        h = hat(k, *cfg.HAT_ANCHOR, **cfg.HAT_OPTS.get(k, {}))
        parent_bone(h, arm, 'head'); acc.append(h)
    if hasattr(cfg, 'extra'):
        for o, bn in cfg.extra(body, tint):
            parent_bone(o, arm, bn); acc.append(o)
    arm.location = loc; arm.rotation_euler = [R(a) for a in rot]
    return arm, skin, acc


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def export(cfg, out, concept):
    reset()
    arm, skin, acc = build(cfg, cfg.COLORS[0], cfg.HATS, concept, 'body')
    A = dict(AMP); A.update(getattr(cfg, 'AMP', {}))
    make_actions(arm, A)
    if hasattr(cfg, 'extra_actions'): cfg.extra_actions(acc)
    bpy.ops.object.select_all(action='DESELECT')
    for o in [arm, skin] + acc: o.select_set(True)
    path = os.path.join(out, concept + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB',
                              export_animations=True, export_animation_mode='NLA_TRACKS',
                              export_skins=True, export_yup=True, export_apply=False,
                              export_draco_mesh_compression_enable=False)
    t = tri_count(skin); ta = {a.name: tri_count(a) for a in acc}
    # inspect the glb
    with open(path, 'rb') as f:
        f.read(12); ln, _ = struct.unpack('<II', f.read(8)); js = json.loads(f.read(ln))
    anims = [a['name'] for a in js.get('animations', [])]
    mats = [m['name'] for m in js.get('materials', [])]
    info = dict(concept=concept, body_tris=t, acc_tris=ta, anims=anims, mats=mats,
                kb=os.path.getsize(path) // 1024, joints=len(js['skins'][0]['joints']))
    print('EXPORT', json.dumps(info))
    with open(os.path.join(out, concept + '_info.json'), 'w') as f: json.dump(info, f)


# ------------------------------------------------------------------ render
def stage(floor='#ece4d9', cam_loc=(0, -9.0, 2.35), target=(0, 0, 0.8), lens=46):
    sc = ctx().scene
    # cyclorama sweep
    bm = bmesh.new(); prof = [(-12, 0)] + [(6 + 4 * math.sin(a), 4 - 4 * math.cos(a)) for a in [i / 10 * math.pi / 2 for i in range(11)]] + [(10, 40)]
    rows = []
    for x in (-25, 25):
        rows.append([bm.verts.new((x, y, z)) for y, z in prof])
    for i in range(len(prof) - 1):
        bm.faces.new((rows[0][i], rows[1][i], rows[1][i + 1], rows[0][i + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cy = obj_from_bm('cyc', bm, mat('floor', floor, 0.85), smooth=True)
    for f in cy.data.polygons:
        if f.normal.z < 0: f.flip()
    w = D.worlds.new('w'); sc.world = w
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (*lin('#fbf6f0'), 1); bg.inputs[1].default_value = 0.55

    def area(loc, energy, size, col='#ffffff'):
        l = D.lights.new('a', 'AREA'); l.energy = energy; l.size = size; l.color = lin(col)
        o = D.objects.new('a', l); sc.collection.objects.link(o); o.location = loc
        d = Vector(target) - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    area((-4.5, -6.5, 6.5), 1500, 7, '#fff3e3')   # key
    area((6, -5, 3), 500, 6, '#e8f0ff')           # fill
    area((0, 4, 5), 500, 5, '#ffffff')            # rim
    cd = D.cameras.new('cam'); cd.lens = lens; co = D.objects.new('cam', cd); sc.collection.objects.link(co)
    co.location = cam_loc; co.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1000, 460
    vt = os.environ.get('VT', 'Khronos PBR Neutral')
    sc.view_settings.view_transform = vt
    for lk in ('AgX - Punchy', 'Punchy', 'AgX - Medium High Contrast'):
        try: sc.view_settings.look = lk; break
        except Exception as e: print('look fail', lk, e)
    print('LOOK', sc.view_settings.look)
    if vt != 'AgX': sc.view_settings.look = 'None'
    sc.view_settings.exposure = float(os.environ.get('EXPO', '-0.45'))
    sc.cycles.max_bounces = 6


def render(path, w=1000, h=460, samples=32):
    sc = ctx().scene
    sc.render.resolution_x, sc.render.resolution_y = w, h; sc.cycles.samples = samples
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)


def run(cfg, concept):
    out = sys.argv[sys.argv.index('--') + 1]
    what = sys.argv[sys.argv.index('--') + 2:] or ['export', 'lineup', 'action']
    if 'export' in what: export(cfg, out, concept)
    if 'lineup' in what:
        reset(); stage(**getattr(cfg, 'STAGE', {}))
        xs = [-2.25, -0.75, 0.75, 2.25]; turns = getattr(cfg, 'TURNS', [18, 7, -7, -18])
        for i in range(4):
            arm, skin, acc = build(cfg, cfg.COLORS[i], [cfg.HATS[i]], f'p{i}', f'body{i}', (xs[i] * cfg.SPACING, 0, 0), (0, 0, turns[i]))
            apply_pose(arm, POSES['idle'][0](0.15 + 0.2 * i, AMP))
        if os.environ.get('TEST'):
            render(os.path.join(out, concept + '_test_' + os.environ['TEST'] + '.png'), 500, 230, 16)
        else:
            render(os.path.join(out, concept + '.png'))
            render(os.path.join(out, concept + '_small.png'), 435, 200, 24)
    if 'close' in what:
        reset(); stage(cam_loc=(0, -6.0, 1.6), target=(0, 0, 0.7), lens=38)
        for i, (x, rz) in enumerate(((-1.6, 0), (0, 40), (1.6, 150))):
            arm, skin, acc = build(cfg, cfg.COLORS[i], [cfg.HATS[i]] if i == 0 else [], f'c{i}', f'body{i}', (x, 0, 0), (0, 0, rz))
            apply_pose(arm, POSES['idle'][0](0.1, AMP))
        render(os.path.join(out, concept + '_close.png'), 900, 420, 24)
    if 'action' in what:
        st = dict(getattr(cfg, 'STAGE', {})); st.setdefault('lens', 40); st.setdefault('target', (0, 0, 0.95))
        reset(); stage(**st)
        A = dict(AMP); A.update(getattr(cfg, 'AMP', {}))
        H = cfg.HEIGHT
        setups = getattr(cfg, 'SETUPS', None) or [(0, 'run', 0.3, (-2.4, 0, 0), (0, 0, 35)),
                  (1, 'jump', 0.1, (-0.85, 0.3, 0.2 * H), (0, 0, 12)),
                  (2, 'tumble', 0.2, (0.6, 0.5, 0.45 * H), (-20, 60, -10)),
                  (3, 'run', 0.8, (2.7, -0.3, 0), (0, 0, -40))]
        for i, act, t, loc, rot in setups:
            arm, skin, acc = build(cfg, cfg.COLORS[i], [cfg.HATS[i]], f'p{i}', f'body{i}', (loc[0] * cfg.SPACING, loc[1], loc[2]), rot)
            apply_pose(arm, POSES[act][0](t, A))
            if hasattr(cfg, 'pose_extra'): cfg.pose_extra(acc, act, t)
        render(os.path.join(out, concept + '_action.png'))
