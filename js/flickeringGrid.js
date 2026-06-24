(function () {
  const canvas = document.querySelector("[data-flickering-grid]");

  if (!canvas) {
    return;
  }

  const config = {
    squareSize: 2,
    gridGap: 10,
    flickerChance: 0.34,
    maxOpacity: 0.32,
    color: [255, 255, 255],
  };
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ctx = canvas.getContext("2d", { alpha: true });
  let grid = null;
  let animationFrame = null;
  let lastTime = 0;

  if (!ctx) {
    return;
  }

  function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const step = config.squareSize + config.gridGap;
    const cols = Math.ceil(width / step);
    const rows = Math.ceil(height / step);
    const squares = new Float32Array(cols * rows);

    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    for (let i = 0; i < squares.length; i += 1) {
      squares[i] = Math.random() * config.maxOpacity;
    }

    grid = {
      cols,
      rows,
      squares,
      dpr,
      step,
    };

    canvas.dataset.ready = "true";
    canvas.dataset.cells = String(cols * rows);
    drawGrid();
  }

  function updateSquares(deltaTime) {
    for (let i = 0; i < grid.squares.length; i += 1) {
      if (Math.random() < config.flickerChance * deltaTime) {
        grid.squares[i] = Math.random() * config.maxOpacity;
      }
    }

  }

  function drawGrid() {
    const [r, g, b] = config.color;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let col = 0; col < grid.cols; col += 1) {
      for (let row = 0; row < grid.rows; row += 1) {
        const opacity = grid.squares[col * grid.rows + row];

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        ctx.fillRect(
          col * grid.step * grid.dpr,
          row * grid.step * grid.dpr,
          config.squareSize * grid.dpr,
          config.squareSize * grid.dpr
        );
      }
    }

    canvas.dataset.lastDraw = String(Date.now());
  }

  function animate(time) {
    if (!grid || mediaQuery.matches) {
      return;
    }

    const deltaTime = Math.min((time - lastTime) / 1000 || 0, 0.08);
    lastTime = time;
    updateSquares(deltaTime);
    drawGrid();
    canvas.dataset.motion = "active";
    animationFrame = requestAnimationFrame(animate);
  }

  function start() {
    cancelAnimation();
    lastTime = 0;
    setupCanvas();

    if (!mediaQuery.matches) {
      animationFrame = requestAnimationFrame(animate);
    }
  }

  function cancelAnimation() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  window.addEventListener("resize", start);
  mediaQuery.addEventListener("change", start);
  start();
})();
