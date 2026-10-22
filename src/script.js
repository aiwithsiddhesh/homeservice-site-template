const form = document.querySelector('form');
const status = document.querySelector('#form-status');

form?.addEventListener('submit', event => {
  if (form.elements._gotcha.value) {
    event.preventDefault();
    status.textContent = 'Unable to submit. Please call us directly.';
    return;
  }
  if (!form.dataset.mailto) return;
  event.preventDefault();
  const data = new FormData(form);
  const body = `Name: ${data.get('name')}\nPhone: ${data.get('phone')}\n\n${data.get('message')}`;
  const href = `${form.dataset.mailto}?subject=${encodeURIComponent('Free quote request')}&body=${encodeURIComponent(body)}`;
  status.textContent = 'Your email app should open. Review the draft and send it there. If it does not open, please call us.';
  window.location.href = href;
});

document.querySelectorAll('[data-youtube-id]').forEach(button => {
  const thumbnail = button.querySelector('img');
  if (thumbnail) {
    thumbnail.addEventListener('error', () => thumbnail.remove(), { once: true });
    if (thumbnail.complete && thumbnail.naturalWidth === 0) thumbnail.remove();
  }
  button.addEventListener('click', () => {
    const id = button.dataset.youtubeId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;
    iframe.title = button.dataset.videoTitle;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    button.replaceWith(iframe);
    iframe.focus();
  }, { once: true });
});
