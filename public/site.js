// Shared across every page: the "Need help?" popover in the top bar.

const helpBtn = document.getElementById("help-btn");
const helpPopover = document.getElementById("help-popover");

if (helpBtn && helpPopover) {
  helpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !helpPopover.hidden;
    helpPopover.hidden = isOpen;
    helpBtn.setAttribute("aria-expanded", String(!isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".help-wrap")) {
      helpPopover.hidden = true;
      helpBtn.setAttribute("aria-expanded", "false");
    }
  });
}