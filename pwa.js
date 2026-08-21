const installButton = document.querySelector("#installButton");
const installOverlay = document.querySelector("#installOverlay");
const installSheet = document.querySelector("#installSheet");
const installClose = document.querySelector("#installClose");

const isStandalone = window.matchMedia("(display-mode: standalone)").matches
  || window.navigator.standalone === true;
const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
let deferredInstallPrompt = null;

function showInstallHelp() {
  installOverlay.classList.remove("hidden");
  document.body.classList.add("install-open");
  installClose.focus();
}

function hideInstallHelp() {
  installOverlay.classList.add("hidden");
  document.body.classList.remove("install-open");
  installButton.focus();
}

if (!isStandalone && (isIos || "BeforeInstallPromptEvent" in window)) {
  installButton.classList.remove("hidden");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isStandalone) installButton.classList.remove("hidden");
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt || isIos) {
    showInstallHelp();
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

installClose.addEventListener("click", hideInstallHelp);
installOverlay.addEventListener("click", (event) => {
  if (!installSheet.contains(event.target)) hideInstallHelp();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !installOverlay.classList.contains("hidden")) {
    hideInstallHelp();
  }
});

window.addEventListener("appinstalled", () => {
  installButton.classList.add("hidden");
  deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.warn("Offline support could not be enabled.", error);
    });
  });
}
