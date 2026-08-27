/**
 * js/signature-pad.js
 * 부드러운 터치 및 마우스 지원 전자 서명 패드 모듈
 */

class SmoothSignaturePad {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.options = Object.assign({
      strokeColor: '#0f172a',
      minWidth: 1.5,
      maxWidth: 3.5,
      dotSize: 2.0,
      backgroundColor: 'transparent'
    }, options);

    this.points = [];
    this.history = [];
    this.isDrawing = false;
    this.lastVelocity = 0;
    this.lastWidth = (this.options.minWidth + this.options.maxWidth) / 2;

    this.init();
  }

  init() {
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    // 마우스 이벤트
    this.canvas.addEventListener('mousedown', (e) => this.handleStart(e));
    window.addEventListener('mousemove', (e) => this.handleMove(e));
    window.addEventListener('mouseup', (e) => this.handleEnd(e));

    // 모바일 터치 이벤트
    this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
  }

  resizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = this.canvas.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0) return;

    // 현재 그려진 내용 백업
    let currentData = null;
    if (!this.isEmpty()) {
      currentData = this.toDataURL();
    }

    this.canvas.width = rect.width * ratio;
    this.canvas.height = rect.height * ratio;
    this.ctx.scale(ratio, ratio);

    if (currentData) {
      const img = new Image();
      img.onload = () => {
        this.ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = currentData;
    }
  }

  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      time: Date.now()
    };
  }

  handleStart(e) {
    if (e.target !== this.canvas) return;
    this.isDrawing = true;
    this.canvas.classList.add('drawing');
    const point = this.getPoint(e);
    this.points = [point];
    this.drawDot(point);
  }

  handleMove(e) {
    if (!this.isDrawing) return;
    const point = this.getPoint(e);
    this.points.push(point);

    if (this.points.length > 2) {
      const p1 = this.points[this.points.length - 2];
      const p2 = this.points[this.points.length - 1];
      const p0 = this.points[this.points.length - 3];
      this.drawCurve(p0, p1, p2);
    }
  }

  handleEnd(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.canvas.classList.remove('drawing');
    this.points = [];
    if (!this.isEmpty()) {
      this.saveHistory();
    }
  }

  handleTouchStart(e) {
    if (e.target !== this.canvas) return;
    e.preventDefault();
    const touch = e.touches[0];
    this.handleStart(touch);
  }

  handleTouchMove(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    const touch = e.touches[0];
    this.handleMove(touch);
  }

  handleTouchEnd(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    this.handleEnd(e);
  }

  drawDot(point) {
    this.ctx.beginPath();
    this.ctx.fillStyle = this.options.strokeColor;
    this.ctx.arc(point.x, point.y, this.options.dotSize, 0, Math.PI * 2, true);
    this.ctx.fill();
  }

  drawCurve(p0, p1, p2) {
    const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const time = p2.time - p1.time || 1;
    const velocity = distance / time;

    // 속도에 따른 펜 굵기 감쇠 처리 (부드러운 필압 효과)
    const targetWidth = Math.max(
      this.options.minWidth,
      this.options.maxWidth / (velocity * 0.3 + 1)
    );
    const currentWidth = this.lastWidth + (targetWidth - this.lastWidth) * 0.4;
    this.lastWidth = currentWidth;

    this.ctx.beginPath();
    this.ctx.moveTo(mid1.x, mid1.y);
    this.ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    this.ctx.strokeStyle = this.options.strokeColor;
    this.ctx.lineWidth = currentWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
  }

  saveHistory() {
    this.history.push(this.toDataURL());
    if (this.history.length > 20) this.history.shift();
  }

  undo() {
    if (this.history.length === 0) return;
    this.history.pop(); // 현재 상태
    this.clear(false);

    if (this.history.length > 0) {
      const lastState = this.history[this.history.length - 1];
      const img = new Image();
      img.onload = () => {
        const rect = this.canvas.getBoundingClientRect();
        this.ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = lastState;
    }
  }

  clear(clearHistory = true) {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    this.points = [];
    if (clearHistory) {
      this.history = [];
    }
  }

  isEmpty() {
    const pixelBuffer = new Uint32Array(
      this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data.buffer
    );
    return !pixelBuffer.some(color => color !== 0);
  }

  toDataURL(type = 'image/png') {
    return this.canvas.toDataURL(type);
  }
}

window.SmoothSignaturePad = SmoothSignaturePad;
