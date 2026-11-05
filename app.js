
const video = document.getElementById("camera");
const statusBox = document.getElementById("status");
const message = document.getElementById("cameraMessage");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

let stream = null;

async function startCamera() {
  if (stream) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    statusBox.textContent = "CAMERA INDISPONIBILA";
    message.textContent = "Este necesar HTTPS sau localhost.";
    return;
  }

  startBtn.disabled = true;
  statusBox.textContent = "PORNIRE CAMERA...";
  statusBox.className = "status idle";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });

    video.srcObject = stream;
    await video.play();

    statusBox.textContent = "CAMERA ACTIVA";
    statusBox.className = "status running";
    message.textContent = "Pregatit pentru calibrare";
  } catch (error) {
    console.error(error);

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    statusBox.textContent = "EROARE CAMERA";
    statusBox.className = "status nok";
    message.textContent = error.name + ": " + error.message;
    startBtn.disabled = false;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  video.pause();
  video.srcObject = null;

  statusBox.textContent = "CAMERA OPRITA";
  statusBox.className = "status idle";
  message.textContent = "Camera este oprita";
  startBtn.disabled = false;
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);

window.addEventListener("pagehide", stopCamera);
