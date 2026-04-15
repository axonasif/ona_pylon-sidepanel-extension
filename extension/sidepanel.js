const frame = document.getElementById('gitpod-frame');
const loading = document.getElementById('loading');
const loadingText = document.querySelector('.loading-text');

frame.addEventListener('load', () => {
  loading.classList.add('hidden');
});

frame.addEventListener('error', (e) => {
  loadingText.textContent = 'Failed to load — check extension permissions';
  console.error('iframe error:', e);
});

// Hide loading after 10s regardless (in case load event doesn't fire)
setTimeout(() => {
  if (!loading.classList.contains('hidden')) {
    loadingText.textContent = 'Still loading… right-click → Inspect to check console for errors';
  }
}, 10000);

document.getElementById('btn-reload').addEventListener('click', () => {
  loading.classList.remove('hidden');
  loadingText.textContent = 'Loading Gitpod…';
  frame.src = frame.src;
});

document.getElementById('btn-open').addEventListener('click', () => {
  window.open('https://app.gitpod.io', '_blank');
});
