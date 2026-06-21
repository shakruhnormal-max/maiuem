/* ============================================================
   EXPORT.JS  —  экспорт видео через MediaRecorder
   
   Стратегия: захватываем stream с Three.js canvas (renderer.domElement)
   через canvas.captureStream(fps). MediaRecorder записывает в WebM (VP9).
   Для получения MP4 в браузере без FFmpeg.wasm потребовался бы
   дополнительный транскодер — поэтому экспортируем WebM, который
   затем можно открыть в любом современном плеере или конвертировать
   локально. Это честный и надёжный выбор для браузерного приложения.
   ============================================================ */
window.Export = (function () {
  const modal = document.getElementById('export-modal');
  const progress = document.getElementById('export-progress');
  const pbar = document.getElementById('export-pbar');
  const statusEl = document.getElementById('export-status');

  let recording = false;
  let mediaRecorder = null;
  let chunks = [];

  document.getElementById('export-btn').addEventListener('click', () => {
    if (!App.state.videoLoaded) {
      alert('Сначала загрузите видео.');
      return;
    }
    modal.classList.add('open');
    progress.style.display = 'none';
    pbar.value = 0;
  });

  document.getElementById('exp-cancel-btn').addEventListener('click', () => {
    if (recording) _stopRecording();
    modal.classList.remove('open');
  });

  document.getElementById('exp-start-btn').addEventListener('click', async () => {
    await _startExport();
  });

  async function _startExport() {
    const fps = parseInt(document.getElementById('exp-fps').value) || 30;
    const resH = parseInt(document.getElementById('exp-res').value) || 1080;

    const { state } = App;
    const video = state.video;
    if (!video) return;

    // пауза текущего воспроизведения
    video.pause();
    state.playing = false;
    document.getElementById('play-btn').textContent = '▶';

    progress.style.display = '';
    pbar.value = 0;
    document.getElementById('exp-start-btn').disabled = true;
    statusEl.textContent = 'Инициализация...';

    // получаем canvas рендерера
    const rendererCanvas = Scene.getRendererCanvas();

    // устанавливаем разрешение рендерера на время экспорта
    const origW = rendererCanvas.width;
    const origH = rendererCanvas.height;
    const exportH = resH;
    const exportW = Math.round(resH * (state.videoWidth / state.videoHeight));

    App.state.renderer.setSize(exportW, exportH);

    // выбор кодека
    const mimeTypes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    let mimeType = '';
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
    }
    if (!mimeType) {
      alert('Ваш браузер не поддерживает MediaRecorder. Попробуйте Chrome.');
      App.state.renderer.setSize(origW, origH);
      document.getElementById('exp-start-btn').disabled = false;
      return;
    }

    statusEl.textContent = `Кодек: ${mimeType}`;

    chunks = [];
    const stream = rendererCanvas.captureStream(fps);
    mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // WebM файл (браузерный максимум без FFmpeg)
      a.download = `3d-overlay-export-${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      // восстановить размер
      App.state.renderer.setSize(origW, origH);
      statusEl.textContent = '✅ Готово! Файл сохранён.';
      pbar.value = 100;
      document.getElementById('exp-start-btn').disabled = false;
      recording = false;
    };

    recording = true;
    mediaRecorder.start(100); // chunk каждые 100ms

    // перематываем в начало и воспроизводим покадрово
    video.currentTime = 0;
    state.currentTime = 0;

    await _sleep(200); // дать recorder стартовать

    const dur = state.videoDuration;
    const frameCount = Math.ceil(dur * fps);
    const frameDt = 1 / fps;

    statusEl.textContent = `Рендеринг... 0 / ${frameCount} кадров`;

    for (let f = 0; f < frameCount; f++) {
      if (!recording) break;

      const t = f * frameDt;
      video.currentTime = t;
      state.currentTime = t;

      // ждём seeked
      await _seekVideoTo(video, t);

      // обновляем анимации объектов
      state.objects.forEach(obj => Object3D.animateTick(obj, frameDt));
      if (App.state.videoTexture) App.state.videoTexture.needsUpdate = true;
      App.state.renderer.render(App.state.scene, App.state.camera);

      pbar.value = Math.round((f / frameCount) * 100);
      statusEl.textContent = `Рендеринг... ${f+1} / ${frameCount} кадров`;

      // даём браузеру дышать каждые 30 кадров
      if (f % 30 === 0) await _sleep(0);
    }

    _stopRecording();
  }

  function _stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recording = false;
  }

  function _seekVideoTo(video, t) {
    return new Promise(resolve => {
      if (Math.abs(video.currentTime - t) < 0.005) { resolve(); return; }
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = t;
      // таймаут на случай если seeked не приходит
      setTimeout(resolve, 200);
    });
  }

  function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  return {};
})();
