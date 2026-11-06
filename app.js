const video = document.getElementById("camera");
const cameraBox = document.getElementById("cameraBox");
const target = document.getElementById("target");
const workCanvas = document.getElementById("workCanvas");
const ctx = workCanvas.getContext("2d", { willReadFrequently: true });

const statusBox = document.getElementById("status");
const message = document.getElementById("cameraMessage");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const setRoiBtn = document.getElementById("setRoiBtn");
const savePresentBtn = document.getElementById("savePresentBtn");
const saveAbsentBtn = document.getElementById("saveAbsentBtn");
const checkNowBtn = document.getElementById("checkNowBtn");
const toggleAutoBtn = document.getElementById("toggleAutoBtn");
const resetBtn = document.getElementById("resetBtn");

const totalEl = document.getElementById("total");
const okCountEl = document.getElementById("okCount");
const nokCountEl = document.getElementById("nokCount");

const modeLabel = document.getElementById("modeLabel");
const roiLabel = document.getElementById("roiLabel");
const presentScoreEl = document.getElementById("presentScore");
const absentScoreEl = document.getElementById("absentScore");
const decisionLabel = document.getElementById("decisionLabel");

let stream = null;
let autoMode = false;
let inspectTimer = null;
let lastAutoSignature = null;
let autoLocked = false;

let total = 0;
let okCount = 0;
let nokCount = 0;

let roi = {
  x: 50,   // procente in container
  y: 50,
  w: 80,   // pixeli CSS
  h: 80
};

let setRoiMode = false;

let referencePresent = null;
let referenceAbsent = null;

function updateCounters() {
  totalEl.textContent = total;
  okCountEl.textContent = okCount;
  nokCountEl.textContent = nokCount;
}

function updateROIBox() {
  target.style.left = roi.x + "%";
  target.style.top = roi.y + "%";
  target.style.width = roi.w + "px";
  target.style.height = roi.h + "px";
  roiLabel.textContent = `${Math.round(roi.w)} x ${Math.round(roi.h)}`;
}

function setStatus(text, cssClass = "idle") {
  statusBox.textContent = text;
  statusBox.className = "status " + cssClass;
}

async function startCamera() {
  if (stream) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("CAMERA INDISPONIBILA", "nok");
    message.textContent = "Este necesar HTTPS sau localhost.";
    return;
  }

  startBtn.disabled = true;
  setStatus("PORNIRE CAMERA...", "idle");

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

    setStatus("CAMERA ACTIVA", "running");
    message.textContent = "Pregatit pentru calibrare";
  } catch (error) {
    console.error(error);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    setStatus("EROARE CAMERA", "nok");
    message.textContent = error.name + ": " + error.message;
    startBtn.disabled = false;
  }
}

function stopCamera() {
  stopAutoInspect();

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  video.pause();
  video.srcObject = null;
  startBtn.disabled = false;
  setStatus("CAMERA OPRITA", "idle");
  message.textContent = "Camera este oprita";
}

function getVideoRectInContainer() {
  const box = cameraBox.getBoundingClientRect();
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;

  const boxRatio = box.width / box.height;
  const videoRatio = vw / vh;

  let drawWidth, drawHeight, offsetX, offsetY;

  if (videoRatio > boxRatio) {
    drawWidth = box.width;
    drawHeight = box.width / videoRatio;
    offsetX = 0;
    offsetY = (box.height - drawHeight) / 2;
  } else {
    drawHeight = box.height;
    drawWidth = box.height * videoRatio;
    offsetY = 0;
    offsetX = (box.width - drawWidth) / 2;
  }

  return { box, drawWidth, drawHeight, offsetX, offsetY };
}

function getROIInVideoPixels() {
  const { box, drawWidth, drawHeight, offsetX, offsetY } = getVideoRectInContainer();

  const centerXBox = (roi.x / 100) * box.width;
  const centerYBox = (roi.y / 100) * box.height;

  const leftBox = centerXBox - roi.w / 2;
  const topBox = centerYBox - roi.h / 2;

  const relX = (leftBox - offsetX) / drawWidth;
  const relY = (topBox - offsetY) / drawHeight;
  const relW = roi.w / drawWidth;
  const relH = roi.h / drawHeight;

  const sx = Math.max(0, Math.round(relX * video.videoWidth));
  const sy = Math.max(0, Math.round(relY * video.videoHeight));
  const sw = Math.max(1, Math.round(relW * video.videoWidth));
  const sh = Math.max(1, Math.round(relH * video.videoHeight));

  return {
    sx,
    sy,
    sw: Math.min(sw, video.videoWidth - sx),
    sh: Math.min(sh, video.videoHeight - sy)
  };
}

function captureROIData() {
  if (!stream || !video.videoWidth || !video.videoHeight) return null;

  const { sx, sy, sw, sh } = getROIInVideoPixels();

  ctx.clearRect(0, 0, workCanvas.width, workCanvas.height);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, workCanvas.width, workCanvas.height);

  const imageData = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
  return imageData.data;
}

function cloneArray(data) {
  return new Uint8ClampedArray(data);
}

function compareArrays(a, b) {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;

  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = a[i] - b[i];
    const dg = a[i + 1] - b[i + 1];
    const db = a[i + 2] - b[i + 2];
    sum += dr * dr + dg * dg + db * db;
  }
  return sum / (a.length / 4);
}

function buildSignature(data) {
  if (!data) return null;
  let sum = 0;
  for (let i = 0; i < data.length; i += 16) {
    sum += data[i] + data[i + 1] + data[i + 2];
  }
  return sum;
}

function inspectCurrentPiece(countResult = false) {
  const current = captureROIData();
  if (!current) {
    message.textContent = "Nu exista cadru video pentru inspectie";
    return null;
  }

  if (!referencePresent || !referenceAbsent) {
    message.textContent = "Fa calibrare PREZENT si ABSENT";
    setStatus("LIPSA CALIBRARE", "nok");
    return null;
  }

  const presentScore = compareArrays(current, referencePresent);
  const absentScore = compareArrays(current, referenceAbsent);

  presentScoreEl.textContent = presentScore.toFixed(0);
  absentScoreEl.textContent = absentScore.toFixed(0);

  let result;
  if (presentScore <= absentScore) {
    result = "OK";
    decisionLabel.textContent = "PREZENT";
    setStatus("OK - SEMN PREZENT", "ok");
    message.textContent = "Modelul seamana cu starea PREZENT";
    if (countResult) {
      total++;
      okCount++;
      updateCounters();
    }
  } else {
    result = "NOK";
    decisionLabel.textContent = "ABSENT";
    setStatus("NOK - SEMN LIPSA", "nok");
    message.textContent = "Modelul seamana cu starea ABSENT";
    if (countResult) {
      total++;
      nokCount++;
      updateCounters();
    }
  }

  return {
    result,
    presentScore,
    absentScore,
    signature: buildSignature(current)
  };
}

function savePresentReference() {
  const data = captureROIData();
  if (!data) {
    message.textContent = "Porneste camera mai intai";
    return;
  }
  referencePresent = cloneArray(data);
  message.textContent = "Calibrare PREZENT salvata";
}

function saveAbsentReference() {
  const data = captureROIData();
  if (!data) {
    message.textContent = "Porneste camera mai intai";
    return;
  }
  referenceAbsent = cloneArray(data);
  message.textContent = "Calibrare ABSENT salvata";
}

function startAutoInspect() {
  if (autoMode) return;
  autoMode = true;
  autoLocked = false;
  lastAutoSignature = null;
  modeLabel.textContent = "Auto";
  toggleAutoBtn.textContent = "AUTO INSPECT ON";
  message.textContent = "Inspectie automata pornita";

  inspectTimer = setInterval(() => {
    if (!stream || !referencePresent || !referenceAbsent) return;

    const data = captureROIData();
    if (!data) return;

    const signature = buildSignature(data);

    if (lastAutoSignature === null) {
      lastAutoSignature = signature;
      return;
    }

    const diff = Math.abs(signature - lastAutoSignature);

    // daca imaginea se schimba mult, inseamna ca piesa s-a schimbat
    if (diff > 1200) {
      autoLocked = false;
    }

    // daca imaginea este relativ stabila si nu am numarat inca piesa
    if (diff < 350 && !autoLocked) {
      const result = inspectCurrentPiece(true);
      if (result) {
        autoLocked = true;
      }
    }

    lastAutoSignature = signature;
  }, 700);
}

function stopAutoInspect() {
  autoMode = false;
  modeLabel.textContent = "Manual";
  toggleAutoBtn.textContent = "AUTO INSPECT OFF";
  if (inspectTimer) {
    clearInterval(inspectTimer);
    inspectTimer = null;
  }
}

function toggleAutoInspect() {
  if (!referencePresent || !referenceAbsent) {
    message.textContent = "Trebuie sa faci CAL PREZENT si CAL ABSENT";
    return;
  }

  if (autoMode) {
    stopAutoInspect();
    message.textContent = "Inspectie automata oprita";
  } else {
    startAutoInspect();
  }
}

function resetCounters() {
  total = 0;
  okCount = 0;
  nokCount = 0;
  updateCounters();
  decisionLabel.textContent = "-";
  presentScoreEl.textContent = "-";
  absentScoreEl.textContent = "-";
  setStatus("ASTEPTARE", "idle");
  message.textContent = "Contoare resetate";
}

function enableSetROI() {
  setRoiMode = true;
  message.textContent = "Atinge centrul zonei dorite";
}

cameraBox.addEventListener("click", (event) => {
  if (!setRoiMode) return;

  const rect = cameraBox.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  roi.x = Math.max(5, Math.min(95, x));
  roi.y = Math.max(5, Math.min(95, y));
  updateROIBox();

  setRoiMode = false;
  message.textContent = "ROI mutat. Daca e bine, fa calibrarea.";
});

window.addEventListener("keydown", (e) => {
  // + si - pentru marimea ROI
  if (e.key === "+" || e.key === "=") {
    roi.w = Math.min(220, roi.w + 10);
    roi.h = Math.min(220, roi.h + 10);
    updateROIBox();
  }

  if (e.key === "-") {
    roi.w = Math.max(30, roi.w - 10);
    roi.h = Math.max(30, roi.h - 10);
    updateROIBox();
  }
});

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
setRoiBtn.addEventListener("click", enableSetROI);
savePresentBtn.addEventListener("click", savePresentReference);
saveAbsentBtn.addEventListener("click", saveAbsentReference);
checkNowBtn.addEventListener("click", () => inspectCurrentPiece(false));
toggleAutoBtn.addEventListener("click", toggleAutoInspect);
resetBtn.addEventListener("click", resetCounters);

window.addEventListener("pagehide", stopCamera);

updateCounters();
updateROIBox();