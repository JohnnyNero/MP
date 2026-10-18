import { VirtualPad, type InputSource } from './input';

/** True on phones/tablets, or when forced with ?touch=1. */
export function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).get('touch') === '1') return true;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

const CSS = `
#touch { position: fixed; inset: 0; pointer-events: none; z-index: 10; user-select: none; -webkit-user-select: none; }
#touch .zone { position: absolute; left: 0; top: 0; bottom: 0; width: 50%; pointer-events: auto; touch-action: none; }
#touch .base { position: absolute; width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.35); background: rgba(255,255,255,.08); display: none; }
#touch .knob { position: absolute; width: 48px; height: 48px; margin: -24px 0 0 -24px; border-radius: 50%;
  background: rgba(255,255,255,.45); left: 55px; top: 55px; }
#touch .hint { position: absolute; left: 18px; bottom: 18px; color: rgba(255,255,255,.35); font: 12px monospace; }
#touch .btn { position: absolute; border-radius: 50%; pointer-events: auto; touch-action: none; display: flex;
  align-items: center; justify-content: center; font: bold 15px monospace; color: #fff;
  background: rgba(255,255,255,.07); border: 2px solid rgba(255,255,255,.3); }
#touch .btn.down { background: rgba(255,208,64,.5); }
#touch .jump { right: 18px; bottom: 22px; width: 74px; height: 74px; }
#touch .action { right: 102px; bottom: 14px; width: 56px; height: 56px; font-size: 12px; }
#touch .back { right: 26px; bottom: 108px; width: 46px; height: 46px; font-size: 11px; }
#touch .small { position: absolute; left: 8px; width: 38px; height: 38px; border-radius: 8px; pointer-events: auto;
  touch-action: none; display: flex; align-items: center; justify-content: center; font: 18px monospace; color: #fff;
  background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.3); }
#touch .fs { top: 40px; }
#touch .quit { top: 86px; }
#rotate { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center;
  text-align: center; background: #14101c; color: #ffd040; font: 18px monospace; padding: 24px; }
@media (orientation: portrait) { body.touch #rotate { display: flex; } }
`;

/**
 * On-screen controls: a floating joystick (touch anywhere on the left half)
 * plus Jump / Action / Back buttons. Feeds a VirtualPad like any gamepad.
 */
export class TouchSource implements InputSource {
  id = 'touch' as const;
  pad = new VirtualPad();
  private jx = 0;
  private jy = 0;
  private held = { jump: false, action: false, back: false };

  constructor() {
    document.body.classList.add('touch');
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const rotate = document.createElement('div');
    rotate.id = 'rotate';
    rotate.textContent = 'Turn your phone sideways to play';
    document.body.appendChild(rotate);

    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="zone"><div class="base"><div class="knob"></div></div><div class="hint">drag to move</div></div>
      <div class="btn action">ACT</div>
      <div class="btn jump">JUMP</div>
      <div class="btn back">BACK</div>
      <div class="small fs" title="Fullscreen">⛶</div>
      <div class="small quit" title="Quit to title">✕</div>`;
    document.body.appendChild(root);

    this.bindJoystick(root.querySelector('.zone')!, root.querySelector('.base')!, root.querySelector('.knob')!, root.querySelector('.hint')!);
    this.bindButton(root.querySelector('.jump')!, 'jump');
    this.bindButton(root.querySelector('.action')!, 'action');
    this.bindButton(root.querySelector('.back')!, 'back');
    root.querySelector('.fs')!.addEventListener('pointerdown', () => void toggleFullscreen());
    root.querySelector('.quit')!.addEventListener('pointerdown', () => window.dispatchEvent(new Event('tabletop-quit')));
    // Stop the page from scrolling, zooming or showing the long-press menu.
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindJoystick(zone: HTMLElement, base: HTMLElement, knob: HTMLElement, hint: HTMLElement) {
    const R = 46;
    let id: number | null = null;
    let ox = 0;
    let oy = 0;
    const move = (e: PointerEvent) => {
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      knob.style.left = `${55 + dx}px`;
      knob.style.top = `${55 + dy}px`;
      const nx = dx / R;
      const ny = dy / R;
      this.jx = Math.abs(nx) < 0.25 ? 0 : nx;
      this.jy = Math.abs(ny) < 0.35 ? 0 : ny;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      ox = e.clientX;
      oy = e.clientY;
      base.style.left = `${ox}px`;
      base.style.top = `${oy}px`;
      base.style.display = 'block';
      hint.style.display = 'none';
      move(e);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.jx = this.jy = 0;
      base.style.display = 'none';
      knob.style.left = knob.style.top = '55px';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private bindButton(el: HTMLElement, key: 'jump' | 'action' | 'back') {
    const set = (v: boolean) => {
      this.held[key] = v;
      el.classList.toggle('down', v);
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      set(true);
    });
    el.addEventListener('pointerup', () => set(false));
    el.addEventListener('pointercancel', () => set(false));
  }

  poll() {
    this.pad.x = this.jx;
    this.pad.y = this.jy;
    this.pad.jumpHeld = this.held.jump;
    this.pad.actionHeld = this.held.action;
    this.pad.commit(this.held.back);
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen();
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.('landscape').catch(() => {});
    }
  } catch {
    // Fullscreen is unavailable on some browsers (e.g. iPhone Safari); ignore.
  }
}
