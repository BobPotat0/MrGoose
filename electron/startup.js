const statusText = document.getElementById('status');
const statusTag = document.getElementById('status-tag');
const retry = document.getElementById('retry');
const progress = document.getElementById('progress');
const intro = document.querySelector('.intro');
const labels = {
  starting: ['Starting Mr Goose…', 'STARTING'],
  service: ['Getting things ready…', 'PREPARING'],
  workspace: ['Opening your workspace…', 'ALMOST READY'],
  ready: ['Ready when you are.', 'READY'],
  error: ['Couldn’t open your workspace.', 'TRY AGAIN'],
};
function setPhase(phase) {
  const selected = Object.hasOwn(labels, phase) ? phase : 'starting';
  document.body.dataset.phase = selected;
  statusText.textContent = labels[selected][0];
  statusTag.textContent = labels[selected][1];
  retry.hidden = selected !== 'error';
  intro.setAttribute('aria-busy', String(selected !== 'error' && selected !== 'ready'));
  progress.setAttribute('aria-hidden', String(selected === 'error'));
  progress.setAttribute('aria-valuetext', labels[selected][0]);
  if (selected === 'ready') progress.setAttribute('aria-valuenow', '100');
  else progress.removeAttribute('aria-valuenow');
}
setPhase('starting');
window.gooseStartup?.onPhase(setPhase);
document.getElementById('close').addEventListener('click', () => window.gooseStartup?.close());
retry.addEventListener('click', () => {
  setPhase('starting');
  window.gooseStartup?.retry();
});