(function () {
  'use strict';
  // Delegation also covers homepage controls mounted by the design runtime.
  document.addEventListener('click', async function (event) {
    var button = event.target && event.target.closest && event.target.closest('[data-share-url]');
    if (!button || button.disabled) return;
    event.preventDefault();
    var url = button.getAttribute('data-share-url');
    var status = button.parentElement.querySelector('[data-share-status]');
    button.disabled = true;
    status.textContent = '';
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ url: url });
      } else {
        await navigator.clipboard.writeText(url);
        status.textContent = 'Link copied';
      }
    } catch (error) {
      // Dismissing the native sheet is not a failure and must not copy a link.
      if (!error || error.name !== 'AbortError') status.textContent = 'Could not share. Try again.';
    } finally {
      button.disabled = false;
    }
  });
})();
