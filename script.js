let playerNames = [];
const container = document.getElementById("container");
const playerNameElement = document.getElementById("playerName");
let scoreOne = 0;
let scoreTwo = 0;
let ballPosX = 335;
let ballPosY = 235;
const playerPosXOne = 0;
let playerPosYOne = 200;
let playerOneVY = 0;
let playerTwoVY = 0;
const playerPosXTwo = 690;
let playerPosYTwo = 200;
let radius = 5;
let ballVY = -4;
let ballVX = -4;
let isWKeyPressed = false;
let isSKeyPressed = false;
let isUpKeyPressed = false;
let isDownKeyPressed = false;

function commitFunktion() {
  if (playerNameElement.placeholder === "Player 2") {
    startGame();
  } else {
    playerNames.push(playerNameElement.value);
    playerNameElement.value = "";
    playerNameElement.className = "playerTwoName";
    playerNameElement.placeholder = "Player 2";
  }
}

function startGame() {
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "canvas";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.canvas.width = "700";
  ctx.canvas.height = "500";

  setInterval(() => {
    if (ballVX > 0) {
      ballVX += 0.2;
    } else if (ballVX < 0) {
      ballVX -= 0.2;
    }
    console.log("CALLED " + Date.now());
  }, 1000);

  function gameLoop() {
    updateGameState();
    render();
    requestAnimationFrame(gameLoop);
  }

  function updateGameState() {
    ballPosX += ballVX;
    ballPosY += ballVY;

    //setTimeout(updateBallspeed, 1000);

    collusion();
    playerOneVY = playerCanvasCollusion(
      playerPosYOne,
      isSKeyPressed,
      isWKeyPressed,
      playerOneVY
    );
    playerTwoVY = playerCanvasCollusion(
      playerPosYTwo,
      isDownKeyPressed,
      isUpKeyPressed,
      playerTwoVY
    );

    playerPosYOne += playerOneVY;
    playerPosYTwo += playerTwoVY;
  }

  function render() {
    clearContent();
    drawBall(ballPosX, ballPosY, radius);
    drawPlayers(playerPosXOne, playerPosYOne, "blue");
    drawPlayers(playerPosXTwo, playerPosYTwo, "red");
    drawScores();

    ctx.beginPath();
    ctx.moveTo(350, 0);
    ctx.lineTo(350, 500);
    ctx.stroke();
  }

  function drawScores() {
    ctx.font = "60px Arial";
    ctx.fillStyle = "black";
    ctx.fillText(scoreOne, 300, 50);
    ctx.fillText(scoreTwo, 365, 50);
  }

  function collusion() {
    if (ballPosY + ballVY + radius >= canvas.height) {
      ballPosY = canvas.height - radius;
      ballVY = -ballVY;
    } else if (ballPosY + ballVY - radius <= 0) {
      ballPosY = 0 + radius;
      ballVY = -ballVY;
    }

    if (
      ballPosX + ballVX + radius >= playerPosXTwo &&
      ballPosY + ballVY + radius >= playerPosYTwo &&
      ballPosY + ballVY + radius <= playerPosYTwo + 101
    ) {
      ballPosX = playerPosXTwo - radius;
      ballVX = -ballVX;
    }

    if (
      ballPosX + ballVX - radius <= playerPosXOne + 11 &&
      ballPosY + ballVY + radius >= playerPosYOne &&
      ballPosY + ballVY + radius <= playerPosYOne + 100
    ) {
      ballPosX = playerPosXOne + 10 + radius;
      ballVX = -ballVX;
    }

    if (ballPosX + ballVX + radius >= canvas.width) {
      scoreOne++;
      ballVX = -4;
      ballVY = -4;
      ballPosX = 335; // use the canvas variables so it´s responsive and future proof
      ballPosY = 235; // use the canvas variables so it´s responsive and future proof
    }

    if (ballPosX + ballVX - radius <= 0) {
      scoreTwo++;
      ballVX = -4;
      ballVY = -4;
      ballPosX = 335; // use the canvas variables so it´s responsive and future proof
      ballPosY = 235; // use the canvas variables so it´s responsive and future proof
    }
  }

  function playerCanvasCollusion(playersPosY, sOrDown, wOrUp, playerVY) {
    let updatedVY = playerVY;

    if (sOrDown && playersPosY + 100 < canvas.height) {
      updatedVY = 6;
    } else if (wOrUp && playersPosY > 0) {
      updatedVY = -6;
    } else {
      updatedVY = 0;
    }

    return updatedVY;
  }

  function clearContent() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawBall(x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "black";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.stroke();
  }

  function drawPlayers(x, y, color) {
    ctx.beginPath();
    ctx.rect(x, y, 10, 100);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.stroke();
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "s" && playerPosYOne + 100 < canvas.height) {
      isSKeyPressed = true;
    } else if (event.key === "w" && playerPosYOne > 0) {
      isWKeyPressed = true;
    }
  });

  document.addEventListener("keyup", function (event) {
    if (event.key === "s") {
      isSKeyPressed = false;
    } else if (event.key === "w") {
      isWKeyPressed = false;
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.keyCode === 40 && playerPosYTwo + 100 < canvas.height) {
      isDownKeyPressed = true;
    } else if (event.keyCode === 38 && playerPosYOne > 0) {
      isUpKeyPressed = true;
    }
  });

  document.addEventListener("keyup", function (event) {
    if (event.keyCode === 40) {
      isDownKeyPressed = false;
    } else if (event.keyCode === 38) {
      isUpKeyPressed = false;
    }
  });

  requestAnimationFrame(gameLoop);
}
