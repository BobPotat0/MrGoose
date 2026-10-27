const api = window.arenaWindow;
const error = document.getElementById('error');
async function action(callback) { try { error.textContent = ''; return await callback(); } catch { error.textContent = 'Action failed. Check the local app log or retry.'; } }
function render(tabs) {
  const nav = document.getElementById('tabs');
  nav.replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement('div'); item.className = 'tab' + (tab.active ? ' active' : '');
    const select = document.createElement('button'); select.className = 'select';
    select.textContent = tab.label || tab.title || 'Arena'; select.title = tab.url;
    select.setAttribute('aria-current', tab.active ? 'page' : 'false'); select.onclick = () => action(() => api.select(tab.id));
    const close = document.createElement('button'); close.className = 'close'; close.textContent = '×';
    close.setAttribute('aria-label', 'Close ' + select.textContent); close.onclick = () => action(() => api.close(tab.id));
    item.append(select, close); nav.append(item);
    if (tab.active) item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
api.onTabs(render); action(async () => render(await api.list()));
document.getElementById('new').onclick = () => action(() => api.create());
document.getElementById('hide').onclick = () => action(() => api.hide());
document.getElementById('cockpit').onclick = () => action(() => api.cockpit());
