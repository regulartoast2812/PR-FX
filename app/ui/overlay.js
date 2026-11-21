// Draws what the listener believes, over Premiere itself: the live Timeline
// rectangle (green when shortcuts are armed, amber when not), the remembered
// one (dashed) and the last click. Click-through; never takes focus.
'use strict';
const $ = id => document.getElementById(id);

function place(el, rect, origin) {
  if (!rect) { el.hidden = true; return; }
  el.hidden = false;
  el.style.left = (rect.x - origin.x) + 'px';
  el.style.top = (rect.y - origin.y) + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
}

function inside(point, rect) {
  return point && rect && point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

window.prfx.onOverlay(state => {
  const origin = state.origin;
  const armed = state.scopeKind === 'full';
  place($('live'), state.live, origin);
  $('live').classList.toggle('off', !armed);
  $('liveTag').textContent = armed ? 'Timeline detected · shortcuts armed' : 'Timeline detected · ' + (state.keyScope || 'click inside to arm');

  // The remembered box only matters when there is no live one, or it differs.
  const same = state.live && state.saved && ['x', 'y', 'width', 'height'].every(k => Math.abs(state.live[k] - state.saved[k]) < 3);
  place($('saved'), same ? null : state.saved, origin);

  const dot = $('dot');
  if (state.click) {
    dot.hidden = false;
    dot.style.left = (state.click.x - origin.x) + 'px';
    dot.style.top = (state.click.y - origin.y) + 'px';
    dot.classList.toggle('outside', !inside(state.click, state.live || state.saved));
  } else dot.hidden = true;

  const banner = $('banner');
  const message = state.panelsHidden ? 'Export/Import mode · plain-key shortcuts paused'
    : !state.live && !state.saved ? 'No Timeline found in this workspace' : '';
  banner.hidden = !message;
  if (message) {
    banner.textContent = message;
    const w = state.window || { x: origin.x, y: origin.y, width: window.innerWidth, height: 0 };
    banner.style.left = (w.x - origin.x + w.width / 2) + 'px';
    banner.style.top = (w.y - origin.y + 44) + 'px';
  }
});
