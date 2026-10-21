'use strict';

document.querySelectorAll('.scheme').forEach((section) => {
  const buttons = [...section.querySelectorAll('[data-angle-target]')];
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const angle = button.dataset.angleTarget;
      buttons.forEach((control) => control.setAttribute('aria-pressed', String(control === button)));
      section.querySelectorAll('.view').forEach((view) => {
        view.hidden = view.dataset.angle !== angle;
      });
    });
  });
});

const dialog = document.getElementById('image-dialog');
const dialogImage = document.getElementById('dialog-image');
const caption = document.getElementById('dialog-caption');
let opener = null;

document.querySelectorAll('[data-zoom]').forEach((button) => {
  button.addEventListener('click', () => {
    opener = button;
    dialogImage.src = button.dataset.zoom;
    dialogImage.alt = button.dataset.caption;
    caption.textContent = button.dataset.caption;
    dialog.showModal();
  });
});
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
dialog.addEventListener('close', () => {
  dialogImage.removeAttribute('src');
  if (opener) opener.focus();
});

document.querySelectorAll('.image-open img').forEach((image) => {
  image.addEventListener('error', () => {
    const surface = image.closest('.image-surface');
    const message = document.createElement('p');
    message.className = 'pending';
    message.setAttribute('role', 'status');
    message.textContent = 'This image is temporarily unavailable. Reload after the next preview build.';
    surface.replaceChildren(message);
  });
});
