const output = document.getElementById('output');

document.querySelectorAll('[data-app]').forEach((button) => {
  button.addEventListener('click', async () => {
    output.textContent = 'Working…';
    const result = await window.jarvis.openApp(button.dataset.app);
    output.textContent = result.message;
  });
});

document.getElementById('open-url').addEventListener('click', async () => {
  const result = await window.jarvis.openUrl(document.getElementById('url').value.trim());
  output.textContent = result.message;
});
