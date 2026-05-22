import fs from 'fs/promises';
import path from 'path';

const DEFAULT_OUT_DIR = '.max/game-code';

const CANVAS_TYPES = new Set(['pong', 'snake', 'breakout']);
const PHASER_TYPES = new Set(['platformer', 'top-down', 'shooter']);

function slugify(input) {
    return String(input || 'game')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'game';
}

function toPosix(p) { return p.replace(/\\/g, '/'); }

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

// ── Canvas templates ──────────────────────────────────────────────────────

function buildCanvasPong(title, w, h) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>*{margin:0}canvas{background:#000;display:block;margin:auto}</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
// setup
const c = document.getElementById('c');
const ctx = c.getContext('2d');
c.width = ${w}; c.height = ${h};
const PAD_W = 12, PAD_H = 70, BALL = 10, SPEED = 4;
let state;
function init() {
    state = {
        p1: { y: h/2 - PAD_H/2, score: 0, dy: 0 },
        p2: { y: h/2 - PAD_H/2, score: 0, dy: 0 },
        ball: { x: w/2, y: h/2, dx: SPEED * (Math.random() > 0.5 ? 1 : -1), dy: SPEED * (Math.random() > 0.5 ? 1 : -1) }
    };
}
const keys = {};
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup',   e => keys[e.key] = false);

// update
function update() {
    const s = state;
    if (keys['w'] || keys['W'])        s.p1.y = Math.max(0, s.p1.y - 5);
    if (keys['s'] || keys['S'])        s.p1.y = Math.min(h - PAD_H, s.p1.y + 5);
    if (keys['ArrowUp'])               s.p2.y = Math.max(0, s.p2.y - 5);
    if (keys['ArrowDown'])             s.p2.y = Math.min(h - PAD_H, s.p2.y + 5);
    s.ball.x += s.ball.dx; s.ball.y += s.ball.dy;
    if (s.ball.y <= BALL || s.ball.y >= h - BALL) s.ball.dy *= -1;
    if (s.ball.x <= PAD_W + BALL && s.ball.y >= s.p1.y && s.ball.y <= s.p1.y + PAD_H) s.ball.dx = Math.abs(s.ball.dx);
    if (s.ball.x >= w - PAD_W - BALL && s.ball.y >= s.p2.y && s.ball.y <= s.p2.y + PAD_H) s.ball.dx = -Math.abs(s.ball.dx);
    if (s.ball.x < 0) { s.p2.score++; init(); }
    if (s.ball.x > w) { s.p1.score++; init(); }
}

// draw
function draw() {
    const s = state;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, s.p1.y, PAD_W, PAD_H);
    ctx.fillRect(w - PAD_W, s.p2.y, PAD_W, PAD_H);
    ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, BALL, 0, Math.PI*2); ctx.fill();
    ctx.font = '32px monospace';
    ctx.fillText(s.p1.score, w/4, 48);
    ctx.fillText(s.p2.score, 3*w/4, 48);
    ctx.setLineDash([8,8]); ctx.strokeStyle='#444';
    ctx.beginPath(); ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.stroke();
    ctx.setLineDash([]);
}

init();
function loop() { update(); draw(); requestAnimationFrame(loop); }
loop();
window.addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') init(); });
</script>
</body>
</html>`;
}

function buildCanvasSnake(title, w, h) {
    const SZ = 20;
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>*{margin:0}canvas{background:#111;display:block;margin:auto}</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
// setup
const c = document.getElementById('c');
const ctx = c.getContext('2d');
const SZ = ${SZ};
c.width = ${w}; c.height = ${h};
const COLS = Math.floor(${w}/SZ), ROWS = Math.floor(${h}/SZ);
let snake, dir, next, food, score, dead, interval;
function rnd(n) { return Math.floor(Math.random() * n); }
function spawnFood(s) {
    const occupied = new Set(s.map(p => p[0]+','+p[1]));
    let f;
    do { f = [rnd(COLS), rnd(ROWS)]; } while (occupied.has(f[0]+','+f[1]));
    return f;
}
function init() {
    snake = [[5,5],[4,5],[3,5]]; dir = [1,0]; next = [1,0]; score = 0; dead = false;
    food = spawnFood(snake);
    if (interval) clearInterval(interval);
    interval = setInterval(update, 120);
}
window.addEventListener('keydown', e => {
    const map = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0],
                  w:[0,-1], s:[0,1], a:[-1,0], d:[1,0] };
    const d = map[e.key];
    if (d && !(d[0]===-dir[0] && d[1]===-dir[1])) next = d;
    if ((e.key==='r'||e.key==='R') && dead) init();
    if (d) e.preventDefault();
});

// update
function update() {
    dir = next;
    const head = [(snake[0][0]+dir[0]+COLS)%COLS, (snake[0][1]+dir[1]+ROWS)%ROWS];
    if (snake.some(p=>p[0]===head[0]&&p[1]===head[1])) { dead=true; clearInterval(interval); return; }
    snake.unshift(head);
    if (head[0]===food[0]&&head[1]===food[1]) { score++; food=spawnFood(snake); } else snake.pop();
}

// draw
function draw() {
    ctx.fillStyle='#111'; ctx.fillRect(0,0,${w},${h});
    ctx.fillStyle='#4caf50';
    snake.forEach((p,i)=>{ ctx.fillStyle=i===0?'#8bc34a':'#4caf50'; ctx.fillRect(p[0]*SZ+1,p[1]*SZ+1,SZ-2,SZ-2); });
    ctx.fillStyle='#f44336'; ctx.fillRect(food[0]*SZ+2,food[1]*SZ+2,SZ-4,SZ-4);
    ctx.fillStyle='#fff'; ctx.font='18px monospace';
    ctx.fillText('Score: '+score, 8, 22);
    if (dead) { ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,${w},${h}); ctx.fillStyle='#fff'; ctx.font='bold 36px monospace'; ctx.textAlign='center'; ctx.fillText('GAME OVER',${w}/2,${h}/2-20); ctx.font='20px monospace'; ctx.fillText('Score: '+score+' — R to restart',${w}/2,${h}/2+20); ctx.textAlign='left'; }
}
init();
function loop() { draw(); requestAnimationFrame(loop); }
loop();
</script>
</body>
</html>`;
}

function buildCanvasBreakout(title, w, h) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>*{margin:0}canvas{background:#0a0a0f;display:block;margin:auto}</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
// setup
const c = document.getElementById('c');
const ctx = c.getContext('2d');
c.width = ${w}; c.height = ${h};
const ROWS=5, COLS=8, BW=${w}/COLS-8, BH=22, BALL=9, PAD_W=90, PAD_H=12, SPEED=5;
const COLORS=['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db'];
let state;
function init() {
    const bricks=[];
    for(let r=0;r<ROWS;r++) for(let cc=0;cc<COLS;cc++)
        bricks.push({x:cc*(BW+8)+4,y:r*(BH+6)+40,alive:true,color:COLORS[r%COLORS.length]});
    state={pad:{x:${w}/2-PAD_W/2},ball:{x:${w}/2,y:${h}-80,dx:SPEED*(Math.random()>.5?1:-1),dy:-SPEED},bricks,score:0,lives:3,over:false,win:false};
}
const keys={};
window.addEventListener('keydown',e=>{keys[e.key]=true;if(e.key==='r'||e.key==='R')init();});
window.addEventListener('keyup',e=>keys[e.key]=false);

// update
function update() {
    if(state.over||state.win)return;
    const s=state;
    if(keys['ArrowLeft']||keys['a'])  s.pad.x=Math.max(0,s.pad.x-6);
    if(keys['ArrowRight']||keys['d']) s.pad.x=Math.min(${w}-PAD_W,s.pad.x+6);
    s.ball.x+=s.ball.dx; s.ball.y+=s.ball.dy;
    if(s.ball.x<=BALL||s.ball.x>=w-BALL) s.ball.dx*=-1;
    if(s.ball.y<=BALL) s.ball.dy=Math.abs(s.ball.dy);
    if(s.ball.y>=h-BALL-PAD_H&&s.ball.x>=s.pad.x&&s.ball.x<=s.pad.x+PAD_W){
        s.ball.dy=-Math.abs(s.ball.dy);
        s.ball.dx+=((s.ball.x-(s.pad.x+PAD_W/2))/${w/2})*3;
    }
    if(s.ball.y>h){s.lives--;if(s.lives<=0)s.over=true;else{s.ball={x:${w}/2,y:${h}-80,dx:SPEED*(Math.random()>.5?1:-1),dy:-SPEED};}}
    for(const b of s.bricks){
        if(!b.alive)continue;
        if(s.ball.x>=b.x&&s.ball.x<=b.x+BW&&s.ball.y>=b.y&&s.ball.y<=b.y+BH){b.alive=false;s.score+=10;s.ball.dy*=-1;break;}
    }
    if(s.bricks.every(b=>!b.alive))s.win=true;
}

// draw
function draw() {
    const s=state;
    ctx.fillStyle='#0a0a0f';ctx.fillRect(0,0,${w},${h});
    s.bricks.forEach(b=>{if(!b.alive)return;ctx.fillStyle=b.color;ctx.fillRect(b.x,b.y,BW,BH);});
    ctx.fillStyle='#eee';ctx.fillRect(s.pad.x,${h}-PAD_H-10,PAD_W,PAD_H);
    ctx.beginPath();ctx.arc(s.ball.x,s.ball.y,BALL,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();
    ctx.fillStyle='#fff';ctx.font='16px monospace';ctx.fillText('Score:'+s.score,8,20);ctx.fillText('Lives:'+s.lives,${w}-90,20);
    if(s.over){overlay('GAME OVER','R to restart');}
    if(s.win){overlay('YOU WIN!','Score: '+s.score+' — R to play again');}
}
function overlay(line1,line2){
    ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(0,0,${w},${h});
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 40px monospace';ctx.fillText(line1,${w}/2,${h}/2-20);
    ctx.font='20px monospace';ctx.fillText(line2,${w}/2,${h}/2+20);ctx.textAlign='left';
}
const w=${w},h=${h};
init();
function loop(){update();draw();requestAnimationFrame(loop);}
loop();
</script>
</body>
</html>`;
}

// ── Phaser templates ──────────────────────────────────────────────────────

const PHASER_CDN = 'https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js';

function buildPhaserPlatformer(title, w, h) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>*{margin:0}body{background:#1a1a2e}</style>
</head>
<body>
<script src="${PHASER_CDN}"></script>
<script>
// setup
class GameScene extends Phaser.Scene {
    constructor() { super('Game'); }

    create() {
        this.cameras.main.setBackgroundColor('#1a1a2e');
        const gfx = this.add.graphics();

        // ground + platforms
        gfx.fillStyle(0x4caf50);
        gfx.fillRect(0, ${h - 40}, ${w}, 40);
        gfx.fillStyle(0x795548);
        gfx.fillRect(80, ${h - 130}, 120, 20);
        gfx.fillRect(300, ${h - 200}, 120, 20);
        gfx.fillRect(${w - 200}, ${h - 160}, 120, 20);

        this.platforms = this.physics.add.staticGroup();
        this.makeRect(this.platforms, 0, ${h - 40}, ${w}, 40);
        this.makeRect(this.platforms, 80, ${h - 130}, 120, 20);
        this.makeRect(this.platforms, 300, ${h - 200}, 120, 20);
        this.makeRect(this.platforms, ${w - 200}, ${h - 160}, 120, 20);

        // player
        const pg = this.add.graphics();
        pg.fillStyle(0x3498db); pg.fillRect(0,0,28,36);
        pg.generateTexture('player', 28, 36); pg.destroy();
        this.player = this.physics.add.sprite(60, ${h - 100}, 'player');
        this.player.setBounce(0.1).setCollideWorldBounds(true);

        // coins
        const cg = this.add.graphics();
        cg.fillStyle(0xf1c40f); cg.fillCircle(8,8,8);
        cg.generateTexture('coin', 16, 16); cg.destroy();
        this.coins = this.physics.add.staticGroup();
        [[140,${h-155}],[360,${h-225}],[${w-160},${h-185}],[${w/2},${h-80}]].forEach(([x,y])=>this.coins.create(x,y,'coin'));

        this.physics.add.collider(this.player, this.platforms);
        this.physics.add.overlap(this.player, this.coins, (_p,coin)=>{ coin.destroy(); this.score++; this.scoreTxt.setText('Score: '+this.score); });
        this.physics.world.setBounds(0, 0, ${w}, ${h});
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({up:'W',left:'A',right:'D'});
        this.score = 0;
        this.scoreTxt = this.add.text(10, 10, 'Score: 0', { fontSize:'18px', color:'#fff' }).setScrollFactor(0);
        this.add.text(${w/2}, 10, '${title}', { fontSize:'14px', color:'#aaa' }).setOrigin(0.5,0).setScrollFactor(0);
    }

    makeRect(group, x, y, w, h) {
        const r = this.add.rectangle(x + w/2, y + h/2, w, h);
        this.physics.add.existing(r, true);
        group.add(r);
    }

    // update
    update() {
        const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
        const right = this.cursors.right.isDown || this.wasd.right.isDown;
        const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
        if (left)  this.player.setVelocityX(-200);
        else if (right) this.player.setVelocityX(200);
        else this.player.setVelocityX(0);
        if (up && this.player.body.blocked.down) this.player.setVelocityY(-400);
    }
}

new Phaser.Game({ type: Phaser.AUTO, width: ${w}, height: ${h}, backgroundColor: '#1a1a2e',
    physics: { default: 'arcade', arcade: { gravity: { y: 600 }, debug: false } },
    scene: GameScene });
</script>
</body>
</html>`;
}

function buildPhaserTopDown(title, w, h) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>*{margin:0}body{background:#111}</style>
</head>
<body>
<script src="${PHASER_CDN}"></script>
<script>
// setup
class GameScene extends Phaser.Scene {
    constructor() { super('Game'); }

    create() {
        this.cameras.main.setBackgroundColor('#1b1c2a');
        const TILE = 48, COLS = Math.floor(${w}/TILE), ROWS = Math.floor(${h}/TILE);
        // draw floor tiles
        const gfx = this.add.graphics();
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            gfx.fillStyle((r+c)%2===0?0x1e1f2e:0x23243a);
            gfx.fillRect(c*TILE, r*TILE, TILE, TILE);
        }
        // walls
        const walls = this.physics.add.staticGroup();
        const wallPositions = [[0,0,${w},TILE],[0,${h}-TILE,${w},TILE],[0,0,TILE,${h}],[${w}-TILE,0,TILE,${h}]];
        gfx.fillStyle(0x2c3e50);
        wallPositions.forEach(([x,y,ww,hh])=>{ gfx.fillRect(x,y,ww,hh); const r=this.add.rectangle(x+ww/2,y+hh/2,ww,hh); this.physics.add.existing(r,true); walls.add(r); });

        // player
        const pg = this.add.graphics(); pg.fillStyle(0x3498db); pg.fillCircle(12,12,12); pg.generateTexture('player',24,24); pg.destroy();
        this.player = this.physics.add.sprite(${w/2}, ${h/2}, 'player').setCollideWorldBounds(true);
        this.physics.add.collider(this.player, walls);

        // items to collect
        const ig = this.add.graphics(); ig.fillStyle(0xf39c12); ig.fillTriangle(10,0,20,20,0,20); ig.generateTexture('item',20,20); ig.destroy();
        this.items = this.physics.add.staticGroup();
        for (let i=0;i<6;i++) this.items.create(TILE*1.5+Math.random()*(${w}-TILE*3), TILE*1.5+Math.random()*(${h}-TILE*3), 'item');
        this.physics.add.overlap(this.player, this.items, (_p,item)=>{ item.destroy(); this.score++; this.scoreTxt.setText('Score: '+this.score); });

        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({up:'W',down:'S',left:'A',right:'D'});
        this.score = 0;
        this.scoreTxt = this.add.text(10,10,'Score: 0',{fontSize:'18px',color:'#fff'}).setScrollFactor(0);
        this.add.text(${w/2},10,'${title}',{fontSize:'14px',color:'#aaa'}).setOrigin(0.5,0).setScrollFactor(0);
    }

    // update
    update() {
        const spd = 220;
        const vx = (this.cursors.left.isDown||this.wasd.left.isDown)?-spd:(this.cursors.right.isDown||this.wasd.right.isDown)?spd:0;
        const vy = (this.cursors.up.isDown||this.wasd.up.isDown)?-spd:(this.cursors.down.isDown||this.wasd.down.isDown)?spd:0;
        this.player.setVelocity(vx, vy);
    }
}

new Phaser.Game({ type: Phaser.AUTO, width: ${w}, height: ${h},
    physics: { default: 'arcade', arcade: { debug: false } }, scene: GameScene });
</script>
</body>
</html>`;
}

function buildPhaserShooter(title, w, h) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>*{margin:0}body{background:#0a0a0f}</style>
</head>
<body>
<script src="${PHASER_CDN}"></script>
<script>
// setup
class GameScene extends Phaser.Scene {
    constructor() { super('Game'); }

    create() {
        this.cameras.main.setBackgroundColor('#0a0a0f');
        // textures
        const make = (key,fn)=>{ const g=this.add.graphics(); fn(g); g.generateTexture(key,32,32); g.destroy(); };
        make('player', g=>{ g.fillStyle(0x3498db); g.fillTriangle(16,0,0,32,32,32); });
        make('bullet', g=>{ g.fillStyle(0xf1c40f); g.fillRect(14,0,4,16); });
        make('enemy',  g=>{ g.fillStyle(0xe74c3c); g.fillRect(4,4,24,24); });

        this.player = this.physics.add.sprite(${w/2}, ${h-60}, 'player').setCollideWorldBounds(true);
        this.bullets = this.physics.add.group({ defaultKey:'bullet', maxSize:20, runChildUpdate:true });
        this.enemies = this.physics.add.group();
        this.score = 0; this.lives = 3; this.dead = false;
        this.scoreTxt  = this.add.text(10,10,'Score: 0',{fontSize:'18px',color:'#fff'}).setScrollFactor(0);
        this.livesTxt  = this.add.text(${w-120},10,'Lives: 3',{fontSize:'18px',color:'#fff'}).setScrollFactor(0);
        this.titleTxt  = this.add.text(${w/2},10,'${title}',{fontSize:'14px',color:'#aaa'}).setOrigin(0.5,0).setScrollFactor(0);

        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd    = this.input.keyboard.addKeys({left:'A',right:'D'});
        this.spaceKey= this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.lastShot = 0; this.lastSpawn = 0;

        this.physics.add.overlap(this.bullets, this.enemies, (b,e)=>{
            b.setActive(false).setVisible(false).body.reset(0,0);
            e.destroy(); this.score+=10; this.scoreTxt.setText('Score:'+this.score);
        });
        this.physics.add.overlap(this.player, this.enemies, ()=>{
            this.lives--; this.livesTxt.setText('Lives:'+this.lives);
            this.enemies.clear(true,true);
            if(this.lives<=0){ this.dead=true; this.add.text(${w/2},${h/2},'GAME OVER',{fontSize:'40px',color:'#fff'}).setOrigin(0.5); }
        });
    }

    spawnEnemy() {
        const e = this.enemies.create(Phaser.Math.Between(20,${w-20}), -20, 'enemy');
        e.setVelocityY(Phaser.Math.Between(100,220));
    }

    // update
    update(time) {
        if(this.dead) return;
        const spd=280;
        if(this.cursors.left.isDown||this.wasd.left.isDown) this.player.setVelocityX(-spd);
        else if(this.cursors.right.isDown||this.wasd.right.isDown) this.player.setVelocityX(spd);
        else this.player.setVelocityX(0);

        if(Phaser.Input.Keyboard.JustDown(this.spaceKey)||this.cursors.up.isDown){
            if(time-this.lastShot>220){
                this.lastShot=time;
                const b=this.bullets.get(this.player.x,this.player.y-20);
                if(b){ b.setActive(true).setVisible(true); b.body.reset(this.player.x,this.player.y-20); b.setVelocityY(-550); }
            }
        }
        if(time-this.lastSpawn>900){ this.lastSpawn=time; this.spawnEnemy(); }
        this.enemies.getChildren().forEach(e=>{ if(e.y>${h}+20) e.destroy(); });
        this.bullets.getChildren().forEach(b=>{ if(b.active&&b.y<-20){ b.setActive(false).setVisible(false).body.reset(0,0); } });
    }
}

new Phaser.Game({ type: Phaser.AUTO, width: ${w}, height: ${h},
    physics: { default: 'arcade', arcade: { debug: false } }, scene: GameScene });
</script>
</body>
</html>`;
}

// ── from_world: generate a Phaser game from a GameWorldTool world JSON ────

function buildPhaserFromWorld(world, manifest) {
    const tileSize = world.size?.tileSize || 16;
    const mapW = world.size?.width || 32;
    const mapH = world.size?.height || 24;
    const assetDir = manifest.assetDir || 'game_assets';
    const assetMap = new Map((manifest.assets || []).map(a => [a.id, a]));

    // Collect distinct tile ids used in terrain
    const terrain = world.layers?.terrain || [];
    const collision = world.layers?.collision || [];
    const objects = world.objects || [];

    const usedTiles = new Set();
    for (const row of terrain) for (const id of row) if (id) usedTiles.add(id);

    const usedObjects = new Set(objects.map(o => o.asset).filter(Boolean));

    // Build preload lines
    const preloadLines = [];
    for (const id of usedTiles) {
        const asset = assetMap.get(id);
        if (asset) preloadLines.push(`        this.load.image('${id}', '../../${assetDir}/${asset.path}');`);
    }
    for (const id of usedObjects) {
        const asset = assetMap.get(id);
        if (asset) preloadLines.push(`        this.load.image('${id}', '../../${assetDir}/${asset.path}');`);
    }

    // Build tile placement lines
    const tilePlaceLines = [];
    for (let y = 0; y < terrain.length; y++) {
        for (let x = 0; x < (terrain[y]?.length || 0); x++) {
            const id = terrain[y][x];
            if (id) tilePlaceLines.push(`        this.add.image(${x * tileSize + tileSize / 2}, ${y * tileSize + tileSize / 2}, '${id}').setDisplaySize(${tileSize},${tileSize});`);
        }
    }

    // Build collision static bodies
    const collisionLines = [];
    const wallGroup = [];
    for (let y = 0; y < collision.length; y++) {
        for (let x = 0; x < (collision[y]?.length || 0); x++) {
            if (collision[y][x] === 1) {
                wallGroup.push(`[${x * tileSize},${y * tileSize}]`);
            }
        }
    }
    if (wallGroup.length > 0) {
        collisionLines.push(`        const wallData = [${wallGroup.join(',')}];`);
        collisionLines.push(`        const walls = this.physics.add.staticGroup();`);
        collisionLines.push(`        wallData.forEach(([wx,wy])=>{ const r=this.add.rectangle(wx+${tileSize/2},wy+${tileSize/2},${tileSize},${tileSize}); this.physics.add.existing(r,true); walls.add(r); });`);
        collisionLines.push(`        this.physics.add.collider(this.player, walls);`);
    }

    // Build object placement lines
    const objLines = [];
    for (const obj of objects) {
        if (assetMap.has(obj.asset)) {
            objLines.push(`        this.add.image(${obj.x * tileSize + tileSize / 2}, ${obj.y * tileSize + tileSize / 2}, '${obj.asset}').setDisplaySize(${tileSize},${tileSize * 1.5 | 0});`);
        }
    }

    // Find entrance position for player spawn
    const entrance = world.zones?.find(z => z.id === 'entrance');
    const spawnX = entrance ? (entrance.bounds[0] + entrance.bounds[2] / 2) * tileSize : 60;
    const spawnY = entrance ? (entrance.bounds[1] + entrance.bounds[3] / 2) * tileSize : 60;

    const canvasW = mapW * tileSize;
    const canvasH = mapH * tileSize;
    const title = world.title || 'World';

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>*{margin:0}body{background:#101015}</style>
</head>
<body>
<script src="${PHASER_CDN}"></script>
<script>
// setup — generated from ${title} (max-game-world-v1)
class GameScene extends Phaser.Scene {
    constructor() { super('Game'); }

    preload() {
${preloadLines.join('\n')}
    }

    create() {
        // terrain tiles
${tilePlaceLines.join('\n')}

        // props and characters
${objLines.join('\n')}

        // player placeholder (replace with real sprite)
        const pg = this.add.graphics(); pg.fillStyle(0x3498db); pg.fillRect(0,0,${tileSize},${tileSize}); pg.generateTexture('__player',${tileSize},${tileSize}); pg.destroy();
        this.player = this.physics.add.sprite(${spawnX}, ${spawnY}, '__player').setCollideWorldBounds(true);

        // collision walls
${collisionLines.join('\n')}

        this.cameras.main.setBounds(0, 0, ${canvasW}, ${canvasH});
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.physics.world.setBounds(0, 0, ${canvasW}, ${canvasH});
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({up:'W',down:'S',left:'A',right:'D'});
        this.add.text(10, 10, '${title}', { fontSize:'14px', color:'#fff' }).setScrollFactor(0);
    }

    // update
    update() {
        const spd = 180;
        const vx = (this.cursors.left.isDown||this.wasd.left.isDown)?-spd:(this.cursors.right.isDown||this.wasd.right.isDown)?spd:0;
        const vy = (this.cursors.up.isDown||this.wasd.up.isDown)?-spd:(this.cursors.down.isDown||this.wasd.down.isDown)?spd:0;
        this.player.setVelocity(vx, vy);
    }
}

new Phaser.Game({ type: Phaser.AUTO, width: Math.min(${canvasW}, window.innerWidth), height: Math.min(${canvasH}, window.innerHeight),
    backgroundColor: '#101015',
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: GameScene });
</script>
</body>
</html>`;
}

// ── Public tool object ─────────────────────────────────────────────────────

export const GameCodeTool = {
    name: 'game_code',
    description: `Generate runnable HTML game files from templates or world data.
Actions:
  scaffold      -> generate a single .html game file (pong/snake/breakout via Canvas, platformer/top-down/shooter via Phaser)
  from_world    -> generate a Phaser.js game from a GameWorldTool world JSON + manifest
  list_templates-> list available game types with descriptions`,

    actions: {
        async scaffold({ type = 'platformer', title = 'My Game', width = 800, height = 600, outDir = DEFAULT_OUT_DIR } = {}) {
            try {
                const t = String(type).toLowerCase().replace(/[-\s]/g, '_').replace('top_down', 'top-down');
                let html;
                if (CANVAS_TYPES.has(t)) {
                    if (t === 'pong')     html = buildCanvasPong(title, width, height);
                    if (t === 'snake')    html = buildCanvasSnake(title, width, height);
                    if (t === 'breakout') html = buildCanvasBreakout(title, width, height);
                } else if (PHASER_TYPES.has(t) || t === 'top-down') {
                    if (t === 'platformer') html = buildPhaserPlatformer(title, width, height);
                    if (t === 'top-down')   html = buildPhaserTopDown(title, width, height);
                    if (t === 'shooter')    html = buildPhaserShooter(title, width, height);
                } else {
                    return { success: false, error: `Unknown type: "${type}". Available: pong, snake, breakout, platformer, top-down, shooter` };
                }

                const outPath = path.join(outDir, `${slugify(title)}.html`);
                await fs.mkdir(outDir, { recursive: true });
                await fs.writeFile(outPath, html, 'utf8');
                return {
                    success: true,
                    outPath: toPosix(outPath),
                    type: t,
                    framework: CANVAS_TYPES.has(t) ? 'canvas' : 'phaser',
                    title
                };
            } catch (err) {
                return { success: false, error: `scaffold failed: ${err.message}` };
            }
        },

        async from_world({ worldPath, manifestPath = 'game_assets/manifest.json', outDir = DEFAULT_OUT_DIR } = {}) {
            try {
                if (!worldPath) return { success: false, error: 'worldPath is required' };
                const [world, manifest] = await Promise.all([readJson(worldPath), readJson(manifestPath)]);
                if (world.schema !== 'max-game-world-v1') {
                    return { success: false, error: 'worldPath does not point to a max-game-world-v1 file' };
                }
                const html = buildPhaserFromWorld(world, manifest);
                const slug = slugify(world.title || path.basename(worldPath, '.json'));
                const outPath = path.join(outDir, `${slug}.html`);
                await fs.mkdir(outDir, { recursive: true });
                await fs.writeFile(outPath, html, 'utf8');
                return { success: true, outPath: toPosix(outPath), title: world.title, framework: 'phaser' };
            } catch (err) {
                return { success: false, error: `from_world failed: ${err.message}` };
            }
        },

        list_templates() {
            return {
                success: true,
                templates: [
                    { type: 'pong',       framework: 'canvas', description: 'Two-player Pong. W/S + Arrow keys. Zero dependencies.' },
                    { type: 'snake',      framework: 'canvas', description: 'Classic Snake. WASD or Arrow keys. Grid-based. Zero dependencies.' },
                    { type: 'breakout',   framework: 'canvas', description: 'Breakout / Arkanoid. Arrow keys or A/D. Zero dependencies.' },
                    { type: 'platformer', framework: 'phaser', description: 'Side-scrolling platformer with jump, platforms, and collectables. WASD/Arrows.' },
                    { type: 'top-down',   framework: 'phaser', description: 'Top-down explorer with walls and collectables. WASD/Arrows.' },
                    { type: 'shooter',    framework: 'phaser', description: 'Vertical space shooter. A/D to move, Space to shoot.' },
                ]
            };
        }
    }
};
