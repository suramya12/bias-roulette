// Shared ephemeral toast helper for passport notifications (duplicates, world tour, sets).

export function showToast(text, hostId = 'toastStack') {
  const host = document.getElementById(hostId);
  if (!host) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  host.append(node);
  setTimeout(() => node.remove(), 3200);
}
