const form = document.querySelector('form');
const status = document.querySelector('#form-status');

form.addEventListener('submit', event => {
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
