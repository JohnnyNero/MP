"""TABLETOP bean: plain soft jellybean player character. Run: bvenv/bin/python -I hero.py -- outdir [export lineup action]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
import numpy as np
import bpy, bmesh
from mathutils.bvhtree import BVHTree
from skimage.measure import marching_cubes
from lib import mat, ellipsoid, capsule, tube, decal, Lathe, rcyl, lathe, outline_ellipse, outline_rrect, Vector, R

COLORS = ['#f2353b', '#2a7ff2', '#22c04f', '#ffbf1a']
HATS = ['sprout', 'bow', 'crown', 'propeller']
BODY_MAT = dict(rough=0.6, sss=0.06, sheen=0.25)
HEIGHT = 1.36
SPACING = 0.85
TURNS = [24, 8, -8, -24]
TINT = 0.62                     # body_tint = the lighter painted face patch (recoloured per player)
HAT_ANCHOR = (1.36, 0.27)
HAT_OPTS = {'sprout': dict(sink=0.01), 'bow': dict(tilt=(0, -15, 0), sink=0.02, fwd=0.02),
            'crown': dict(sink=0.07), 'propeller': dict(sink=0.07)}
# arms are modelled in a relaxed A-pose, out from the flanks, so the smooth body/arm blend stays local to the shoulder
JOINTS = dict(root=0.2, spine=(0.3, 0.9), head=1.36,
              shoulder=(0.29, 0.84), elbow=(0.39, 0.745), wrist=(0.48, 0.655), hand=(0.535, 0.585),
              hip=(0.12, 0.29), knee=(0.12, 0.2), ankle=(0.12, 0.11), toe=(-0.2, 0.04))
SY = 0.84
BLEND = 0.06                    # smooth-union radius where the arms grow out of the body
VOXEL = 0.007
BODY_TRIS = 2600
PROFILE = [(0, 0.2), (0.22, 0.22), (0.31, 0.38), (0.33, 0.62), (0.31, 0.95), (0.25, 1.18), (0.14, 1.32), (0, 1.36)]


def cr3(pts, n=3):
    P = [Vector(p) for p in pts]; P = [P[0]] + P + [P[-1]]; out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return out


def parts(body, tint):
    """Plain soft bean: one jellybean mass, a lighter painted face patch (not a hole), two dot eyes,
    short thick nub arms, stubby legs with round feet. No outline, no gimmicks."""
    P = []; ARMS.clear()
    ink = mat('eye', '#18141f', 0.15); white = mat('eye_hl', '#ffffff', 0.2)
    B = Lathe('body', body, PROFILE, seg=28, sy=SY, n=3)
    BODY[0] = (B, body)
    zc = 1.0
    P.append(decal('face', tint, B.obj, B.surf(zc, 0), 0, outline_ellipse(0.34, 0.27), N=28, K=3, thick=0.01, off=0.002, bone='XFER'))
    for s in (1, -1):
        th = s * 0.19; z = zc + 0.02
        n = B.normal(z, th); tilt = -math.degrees(math.asin(n.z)); rot = (tilt, 0, math.degrees(th))
        c = B.surf(z, th, 0.004)
        P.append(ellipsoid('eye', ink, 0.052, c, (0.82, 0.5, 1.45), rot, seg=14, rings=8, bone='head'))
        P.append(ellipsoid('hl', white, 0.014, c + n * 0.022 + Vector((s * 0.008, 0, 0.028)), (1, 0.5, 1.2), rot, seg=8, rings=5, bone='head'))
        side = 'L' if s > 0 else 'R'
        j = JOINTS
        path = [(s * 0.2, 0, 0.865), (s * j['shoulder'][0], 0, j['shoulder'][1]), (s * j['elbow'][0], -0.01, j['elbow'][1]), (s * j['wrist'][0], -0.02, j['wrist'][1])]
        dense = cr3(path, 3)
        rs = [0.1 + 0.006 * i / (len(dense) - 1) for i in range(len(dense))]
        mc = (s * (j['wrist'][0] + 0.03), -0.025, j['wrist'][1] - 0.06); ms = (0.112 * 0.9, 0.112, 0.112 * 1.06)
        ARMS.append(dict(side=side, s=s, dense=dense, rs=rs, mc=mc, ms=ms))
        P.append(capsule('leg', body, (s * 0.12, 0, 0.3), (s * 0.12, 0, 0.12), 0.1, 0.1, seg=12, n=3))
        P.append(ellipsoid('foot', body, 0.125, (s * 0.12, -0.05, 0.078), (1.0, 1.35, 0.62), seg=16, rings=10, bone='foot.' + side))
    P.insert(0, skin_mesh())
    return P


# ------------------------------------------------------------------ one smooth body+arms mesh (signed distance fields)
BODY, ARMS, MC = [None], [], []


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h), h          # h = 1 where a (the first field) wins


def seg_sd(P, a, b, ra, rb):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1) - (ra + (rb - ra) * t)


def body_sd(P, B):
    """Lathe body: distance in the (rho, z) half-plane to the closed profile; rho undoes the y squash."""
    rho = np.hypot(P[:, 0], P[:, 1] / SY); z = P[:, 2]
    poly = np.array(B.prof + [(0.0, B.prof[0][1])])
    d = np.full(len(P), np.inf); inside = np.zeros(len(P), bool)
    for (r1, z1), (r2, z2) in zip(poly, np.roll(poly, -1, axis=0)):
        er, ez = r2 - r1, z2 - z1; ll = er * er + ez * ez
        t = np.clip(((rho - r1) * er + (z - z1) * ez) / max(ll, 1e-12), 0, 1)
        d = np.minimum(d, np.hypot(rho - r1 - t * er, z - z1 - t * ez))
        if ez: inside ^= ((z1 > z) != (z2 > z)) & (rho < r1 + (z - z1) * er / ez)
    return np.where(inside, -d, d)


def arm_sd(P, a):
    D = np.array([tuple(v) for v in a['dense']]); d = np.full(len(P), np.inf)
    for i in range(len(D) - 1): d = np.minimum(d, seg_sd(P, D[i], D[i + 1], a['rs'][i], a['rs'][i + 1]))
    s = np.array(a['ms']); q = (P - np.array(a['mc'])) / s
    k0 = np.linalg.norm(q, axis=1); k1 = np.linalg.norm(q / s, axis=1)
    return smin(d, k0 * (k0 - 1) / np.maximum(k1, 1e-9), 0.035)[0]


def fields(P):
    B = BODY[0][0]; db = body_sd(P, B); out = db; hs = []
    for a in ARMS:
        out, h = smin(out, arm_sd(P, a), BLEND); hs.append(h)
    return out, db, hs


def skin_mesh():
    """Marching-cubes the smooth union, then decimate to a game budget."""
    if not MC:
        lo, hi = np.array([-0.68, -0.42, 0.12]), np.array([0.68, 0.42, 1.44])
        n = np.ceil((hi - lo) / VOXEL).astype(int) + 1
        g = np.stack(np.meshgrid(*[lo[i] + VOXEL * np.arange(n[i]) for i in range(3)], indexing='ij'), -1).reshape(-1, 3)
        sd = np.concatenate([fields(g[i:i + 400000])[0] for i in range(0, len(g), 400000)]).reshape(n)
        v, f, _, _ = marching_cubes(sd, 0.0, spacing=(VOXEL,) * 3)
        MC[:] = [v + lo, f]
    v, f = MC
    me = bpy.data.meshes.new('skin'); me.from_pydata(v.tolist(), [], f[:, ::-1].tolist()); me.validate()
    o = bpy.data.objects.new('skin', me); lib.COLL[0].objects.link(o); me.materials.append(BODY[0][1])
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    dm = o.modifiers.new('dec', 'DECIMATE'); dm.ratio = BODY_TRIS / len(f); dm.use_symmetry = True; dm.symmetry_axis = 'X'
    lib.apply_mods(o); o.data.shade_smooth()
    o['bone'] = 'CUSTOM'; lib.CUSTOM[o.name] = skin_weights
    print('skin: mc tris', len(f), '-> ', lib.tri_count(o))
    return o


def near_weights(src, bvh, co):
    loc, nor, fi, _ = bvh.find_nearest(co)
    names = {g.index: g.name for g in src.vertex_groups}; sv = src.data.vertices; acc = {}; tot = 0
    for vi in src.data.polygons[fi].vertices:
        w = 1 / max((sv[vi].co - loc).length, 1e-4); tot += w
        for gg in sv[vi].groups: acc[names[gg.group]] = acc.get(names[gg.group], 0) + w * gg.weight
    return {k: w / tot for k, w in acc.items()}


def skin_weights(arm, o):
    """Body weights (spine/head) from the plain lathe, arm weights from the plain tube+mitten, mixed by how much
    each field owns the vertex in the smooth union, so the shoulder fillet stretches with the arm."""
    B, bodym = BODY[0]
    srcs = {'body': B.obj}
    lib.heat(arm, B.obj); lib.restrict(B.obj, ['spine', 'head'], 'spine')
    for a in ARMS:
        side = a['side']
        t = lib.tube('armsrc', bodym, a['dense'], a['rs'], 12)
        m = ellipsoid('mitsrc', bodym, 1.0, a['mc'], a['ms'], (0, 0, 0), seg=14, rings=10)
        src = lib.join([t, m], 'arm' + side)
        lib.heat(arm, src); lib.restrict(src, ['upperarm.' + side, 'forearm.' + side, 'hand.' + side], 'upperarm.' + side)
        srcs[side] = src
    bv = {k: BVHTree.FromObject(v, bpy.context.evaluated_depsgraph_get()) for k, v in srcs.items()}
    co = np.array([tuple(v.co) for v in o.data.vertices])
    _, db, hs = fields(co)
    for k in ['spine', 'head'] + [f'{b}.{a["side"]}' for a in ARMS for b in ('upperarm', 'forearm', 'hand')]:
        o.vertex_groups.new(name=k)
    for vi, v in enumerate(o.data.vertices):
        hb = 1.0; mix = {}
        for a, h in zip(ARMS, hs):
            wa = 1 - h[vi]                       # arm's share of this vertex
            if wa > 1e-3:
                for kk, w in near_weights(srcs[a['side']], bv[a['side']], v.co).items(): mix[kk] = mix.get(kk, 0) + hb * wa * w
                hb *= h[vi]
        for kk, w in near_weights(B.obj, bv['body'], v.co).items(): mix[kk] = mix.get(kk, 0) + hb * w
        for kk, w in mix.items():
            if w > 1e-3: o.vertex_groups[kk].add([vi], w, 'REPLACE')
    for src in srcs.values(): bpy.data.objects.remove(src)


# ------------------------------------------------------------------ floppy poses
lr = lib.lr
S_ = math.sin


def pose_idle(t, A):
    p = 2 * math.pi * t; b = S_(p); d = {}
    d['root'] = {'l': (0, 0, 0)}
    d['spine'] = {'r': (2 * b, 0, 1.5 * S_(p + 2)), 's': (1 + 0.015 * b, 1 - 0.025 * b, 1 + 0.015 * b)}
    d['head'] = {'r': (-2 * b, 0, 3 * S_(p + 1))}
    for s in (1, -1):
        o = 0.6 * s
        lr(d, 'upperarm', s, (5 * S_(p + o), 0, 3 + 3 * b))
        lr(d, 'forearm', s, (6 + 6 * S_(p + o - 0.9), 0, 3 * S_(p + o - 0.9)))
        lr(d, 'hand', s, (6 + 8 * S_(p + o - 1.8), 0, 4 * S_(p + o - 1.8)))
    return d


def pose_run(t, A):
    p = 2 * math.pi * t; d = {}
    d['root'] = {'l': (0, A['bob'] * (1 - math.cos(2 * p)) / 2, 0), 'r': (0, 6 * S_(p), 0)}
    d['spine'] = {'r': (16, -7 * S_(p), 2 * S_(p)), 's': (1, 1 - 0.04 * math.cos(2 * p), 1)}
    d['head'] = {'r': (-10, 0, 4 * S_(p))}
    for s in (1, -1):
        ph = p if s > 0 else p + math.pi
        lr(d, 'thigh', s, (A['leg'] * S_(ph), 0, 4))
        lr(d, 'shin', s, (-A['leg'] * 0.9 * (1 - S_(ph + 0.6)) / 2 - 8, 0, 0))
        lr(d, 'foot', s, (12 * S_(ph), 0, 0))
        # big floppy swing, biased backward so the noodles trail
        lr(d, 'upperarm', s, (-55 - A['arm'] * S_(ph), 10 * S_(ph), 48 + 16 * math.cos(ph)))
        lr(d, 'forearm', s, (-12 - 40 * S_(ph - 1.0), 0, -10 + 22 * S_(ph - 1.0)))
        lr(d, 'hand', s, (-15 - 30 * S_(ph - 2.0), 0, -8 + 18 * S_(ph - 2.0)))
    return d


def pose_jump(t, A):
    p = 2 * math.pi * t * 2; d = {}
    d['root'] = {'l': (0, 0, 0)}
    d['spine'] = {'r': (-8, 0, 5 * S_(p / 2)), 's': (0.96, 1.06, 0.96)}
    d['head'] = {'r': (-12, 0, 7 * S_(p / 2 + 1))}
    for s in (1, -1):
        ph = p if s > 0 else p + 2.2
        lr(d, 'upperarm', s, (28 * S_(ph + 1), 0, A['flail'] + 26 * S_(ph)))
        lr(d, 'forearm', s, (20 + 30 * S_(ph - 1.0), 0, -30 + 35 * S_(ph - 1.0)))
        lr(d, 'hand', s, (20 * S_(ph - 2.0), 0, -25 + 30 * S_(ph - 2.0)))
        lr(d, 'thigh', s, (28 + 28 * S_(ph * 0.5 + (0 if s > 0 else math.pi)), 0, 12))
        lr(d, 'shin', s, (-40 - 20 * S_(ph * 0.5), 0, 0))
        lr(d, 'foot', s, (-10, 0, 0))
    return d


def pose_tumble(t, A):
    p = 2 * math.pi * t; d = {}
    d['root'] = {'l': (0, 0, 0)}
    d['spine'] = {'r': (24 + 6 * S_(p), 0, 10 * S_(p + 1))}
    d['head'] = {'r': (22, 14 * S_(p), 10 * S_(p + 2))}
    for s in (1, -1):
        ph = p + (0 if s > 0 else 1.7)
        lr(d, 'upperarm', s, (-20 + 22 * S_(ph + 1), 10 * S_(ph), A['splay'] + 20 * S_(ph)))
        lr(d, 'forearm', s, (40 + 20 * S_(ph - 1), 0, -15 + 10 * S_(ph - 1)))
        lr(d, 'hand', s, (40 + 15 * S_(ph - 2), 0, 10 * S_(ph - 2)))
        lr(d, 'thigh', s, (40 + 15 * S_(ph), 0, 30))
        lr(d, 'shin', s, (-50 - 10 * S_(ph), 0, 0))
        lr(d, 'foot', s, (20, 0, 0))
    return d


lib.POSES.update({'idle': (pose_idle, 36), 'run': (pose_run, 16), 'jump': (pose_jump, 24), 'tumble': (pose_tumble, 30)})
AMP = {'bob': 0.05, 'leg': 62, 'arm': 45, 'flail': 130, 'splay': 70}
lib.AMP.update(AMP)

SETUPS = [(0, 'run', 0.25, (-2.45, 0, 0), (0, 0, 70)),
          (1, 'jump', 0.15, (-0.85, 0.4, 0.22 * HEIGHT), (0, 0, 12)),
          (2, 'tumble', 0.2, (0.6, 0.9, 0.45 * HEIGHT), (-20, 60, -10)),
          (3, 'run', 0.75, (2.7, -0.4, 0), (0, 0, -70))]

if __name__ == '__main__':
    lib.run(sys.modules[__name__], 'bean')
