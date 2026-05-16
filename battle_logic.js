// ==========================================
// battle_logic.js
// バトルエンジンの計算ロジックおよび対戦関連のReactコンポーネント
// ==========================================

const calculateDamageMultiplier = (atkRgb, defRgb) => {
    if (!atkRgb || !defRgb) return 1;
    const sum = (rgb) => Math.max(1, rgb[0] + rgb[1] + rgb[2]);
    const a = { r: atkRgb[0]/sum(atkRgb), g: atkRgb[1]/sum(atkRgb), b: atkRgb[2]/sum(atkRgb) };
    const d = { r: defRgb[0]/sum(defRgb), g: defRgb[1]/sum(defRgb), b: defRgb[2]/sum(defRgb) };
    
    let mult = 0;
    mult += a.r * d.r * 1 + a.g * d.g * 1 + a.b * d.b * 1;
    mult += a.r * d.g * 2 + a.g * d.b * 2 + a.b * d.r * 2;
    mult += a.r * d.b * 0.5 + a.g * d.r * 0.5 + a.b * d.g * 0.5;
    
    const colorRatioA = (atkRgb[0]+atkRgb[1]+atkRgb[2]) / (255*3);
    const colorRatioD = (defRgb[0]+defRgb[1]+defRgb[2]) / (255*3);
    if (colorRatioA < 0.1 || colorRatioD < 0.1) return 1;

    return mult || 1;
};

// --- Match Screen (VS画面) ---
const MatchScreen = ({ onComplete }) => {
    React.useEffect(() => {
        const timer = setTimeout(onComplete, 2000);
        return () => clearTimeout(timer);
    }, [onComplete]);

    return (
        <div className="flex-1 flex items-center justify-center bg-gray-900 text-white animate-pulse">
            <div className="text-6xl font-bold italic tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-yellow-500">
                VS
            </div>
        </div>
    );
};

// --- Battle Engine Screen ---
const BattleScreen = ({ myParts, enemyParts, onEnd }) => {
    const canvasRef = React.useRef(null);
    const camera = React.useRef({ x: 1600, y: 300, scale: 0.5 });
    
    const [timeLeft, setTimeLeft] = React.useState(60);
    const isEnded = React.useRef(false);
    const timeLeftRef = React.useRef(60);
    const timerAccumulator = React.useRef(0);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let animationId;
        let lastTime = performance.now();

        const GRAVITY = 800;
        const FLOOR_Y = 450;

        class Fighter {
            constructor(partsData, startX, dir) {
                this.partsData = JSON.parse(JSON.stringify(partsData));
                this.x = startX;
                this.y = FLOOR_Y - 100;
                this.vx = 0;
                this.vy = 0;
                this.dir = dir;
                this.scale = 0.5;

                this.totalPixels = 0;
                this.footPixels = 0;
                this.totalMaxHp = 0; 
                
                this.partsData.forEach(p => {
                    p.pixels = p.pixels || 0;
                    p.maxHp = 100;
                    if(p.type === 'body') p.maxHp = p.pixels;
                    else if(p.type === 'hand') p.maxHp = p.pixels / 4;
                    else if(p.type === 'foot') p.maxHp = p.pixels / 2;
                    else if(p.type === 'equip') {
                        if(p.subType === 'shield') p.maxHp = p.pixels * 2;
                        else p.maxHp = p.pixels / 2;
                    }
                    if(p.maxHp < 10) p.maxHp = 10;
                    
                    p.hp = p.maxHp;
                    p.active = true;
                    
                    this.totalPixels += p.pixels;
                    if(p.type === 'foot') this.footPixels += p.pixels;
                    
                    this.totalMaxHp += p.maxHp; 

                    p.radius = Math.max(10, Math.max((p.bounds?.maxX||320) - (p.bounds?.minX||320), (p.bounds?.maxY||240) - (p.bounds?.minY||240)) / 2);
                    p.animAngle = 0;
                    p.attackCooldown = 0;
                });

                if(this.totalPixels < 100) this.totalPixels = 100;

                this.updateCenter();
            }

            getCurrentHpSum() {
                return this.partsData.reduce((sum, p) => sum + Math.max(0, p.hp), 0);
            }

            updateCenter() {
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                const activeParts = this.partsData.filter(p => p.active && p.paths && p.paths.length > 0);
                
                if (activeParts.length === 0) return;

                activeParts.forEach(p => {
                    const b = p.bounds || { minX: 320, maxX: 320, minY: 240, maxY: 240 };
                    if (b.minX < minX) minX = b.minX;
                    if (b.maxX > maxX) maxX = b.maxX;
                    if (b.minY < minY) minY = b.minY;
                    if (b.maxY > maxY) maxY = b.maxY;
                });

                this.cx = (minX + maxX) / 2;
                this.cy = (minY + maxY) / 2;
                this.bottomOffset = maxY - this.cy;

                activeParts.forEach(p => {
                    const b = p.bounds || { minX: 320, maxX: 320, minY: 240, maxY: 240 };
                    const boundsCx = (b.minX + b.maxX) / 2;
                    const boundsCy = (b.minY + b.maxY) / 2;
                    p.offsetX = boundsCx - this.cx;
                    p.offsetY = boundsCy - this.cy;
                });
            }

            update(dt, opponent, bullets) {
                if (this.isDefeated()) return;

                this.dir = opponent.x > this.x ? 1 : -1;

                this.x += this.vx * dt;
                this.y += this.vy * dt;

                let isGrounded = false;
                if (this.y >= FLOOR_Y) {
                    this.y = FLOOR_Y;
                    this.vy = 0;
                    isGrounded = true;
                } else {
                    this.vy += GRAVITY * dt;
                }

                this.vx -= this.vx * (isGrounded ? 5.0 : 1.0) * dt;

                const distToOpponent = opponent.x - this.x;
                const currentHasShoot = this.partsData.some(p => p.type === 'equip' && p.subType === 'shoot' && p.active);
                const targetDir = currentHasShoot ? (distToOpponent > 0 ? -1 : 1) : (distToOpponent > 0 ? 1 : -1);
                
                const activeFeet = this.partsData.filter(p => p.type === 'foot' && p.active);
                const hasFeet = activeFeet.length > 0;

                if (hasFeet) {
                    let accel = Math.max(1000, 5000000 / this.totalPixels);
                    if (accel > 3000) accel = 3000;
                    
                    let isFlying = activeFeet.some(p => p.subType === 'fly');
                    if (isFlying) {
                        if (this.y > FLOOR_Y - 150) this.vy -= 1500 * dt;
                        accel *= 1.5;
                    } else {
                        if (!isGrounded) accel *= 0.2;
                    }
                    this.vx += targetDir * accel * dt;
                } else {
                    if (isGrounded && Math.abs(this.vx) < 50) {
                        this.vy = -300;
                        let jumpSpeed = Math.max(200, 1000000 / this.totalPixels);
                        if (jumpSpeed > 400) jumpSpeed = 400;
                        this.vx = targetDir * jumpSpeed;
                    }
                }

                if (this.vx > 600) this.vx = 600;
                if (this.vx < -600) this.vx = -600;

                if (this.x < 50) { this.x = 50; this.vx *= -0.5; }
                if (this.x > 3150) { this.x = 3150; this.vx *= -0.5; }

                let partDestroyed = false;

                this.partsData.forEach(p => {
                    if (!p.active) return;
                    if (p.attackCooldown > 0) p.attackCooldown -= dt;

                    if (p.type === 'foot') {
                        if (p.subType === 'walk' && Math.abs(this.vx) > 10 && isGrounded) {
                            p.animAngle = Math.sin(performance.now() / 100) * 0.5;
                        } else if (p.subType === 'wheel' && Math.abs(this.vx) > 10 && isGrounded) {
                            p.animAngle += (this.vx * dt) / p.radius;
                        } else {
                            p.animAngle = 0;
                        }
                    } else if (p.type === 'hand') {
                        const hasMeleeEquip = this.partsData.some(eq => eq.type === 'equip' && eq.subType === 'melee' && eq.attachedTo === p.id && eq.active);
                        if (hasMeleeEquip) {
                            const timeSec = performance.now() / 1000;
                            p.animAngle = Math.sin(timeSec * 8) * (Math.PI / 2) + (Math.PI / 2);
                        } else {
                            p.animAngle = 0;
                        }
                    } else if (p.type === 'equip' && p.subType === 'melee') {
                        if (p.attachedTo) {
                            const parentHand = this.partsData.find(h => h.id === p.attachedTo);
                            p.animAngle = parentHand ? parentHand.animAngle : 0;
                        } else {
                            p.animAngle = 0;
                        }
                    }

                    p.absX = this.x + p.offsetX * this.dir * this.scale;
                    p.absY = this.y + (p.offsetY - this.bottomOffset) * this.scale;
                    
                    if (p.type === 'body' || p.type === 'hand' || p.type === 'foot' || (p.type === 'equip' && (p.subType === 'melee' || p.subType === 'shield'))) {
                        opponent.partsData.forEach(op => {
                            if (!op.active) return;
                            const dx = op.absX - p.absX;
                            const dy = op.absY - p.absY;
                            const dist = Math.sqrt(dx*dx + dy*dy);
                            const colDist = (p.radius + op.radius) * this.scale * 0.8;
                            
                            if (dist < colDist) {
                                let baseDmg = Math.max(1, p.pixels / 50);
                                let dmgMult = calculateDamageMultiplier(p.rgb, op.rgb);
                                
                                if (p.subType === 'melee') baseDmg *= 1; 
                                if (p.subType === 'shield') baseDmg *= 0.25;
                                if (p.type === 'body' || p.type === 'hand' || p.type === 'foot') baseDmg *= 0.25; 

                                if (op.subType === 'shield' && p.subType === 'melee') baseDmg *= 0.25; 

                                let finalDmg = baseDmg * dmgMult * 5;
                                op.hp -= finalDmg;
                                
                                opponent.vx += (dx > 0 ? 1 : -1) * finalDmg * 2;
                                
                                if (op.hp <= 0) {
                                    op.active = false;
                                    partDestroyed = true;
                                    opponent.vx += (dx > 0 ? 1 : -1) * 400;
                                    opponent.vy = -300;
                                    if (op.type === 'hand') {
                                        opponent.partsData.forEach(dep => {
                                            if (dep.attachedTo === op.id) dep.active = false;
                                        });
                                    }
                                    if (op.type === 'foot' && op.subType === 'fly') {
                                        op.active = false;
                                    }
                                }
                            }
                        });
                    }
                    
                    if (p.type === 'equip' && p.subType === 'shoot') {
                        if (p.attackCooldown <= 0) {
                            const cooldownTime = Math.max(1.0, p.pixels / 1000) * 0.25;
                            p.attackCooldown = cooldownTime;
                            
                            const size = Math.max(4, p.pixels / 400);
                            let vx = this.dir * 400;
                            let vy = 0;
                            
                            if (p.attachedTo) {
                                const oppBody = opponent.partsData.find(op => op.type === 'body' && op.active);
                                if(oppBody) {
                                    const dx = oppBody.absX - p.absX;
                                    const dy = oppBody.absY - p.absY;
                                    const len = Math.sqrt(dx*dx + dy*dy);
                                    vx = (dx/len) * 400;
                                    vy = (dy/len) * 400;
                                }
                            }

                            bullets.push({
                                x: p.absX, y: p.absY, vx, vy, size,
                                rgb: p.rgb,
                                power: p.pixels / 20,
                                owner: this,
                                active: true
                            });
                        }
                    }
                });

                if (partDestroyed) {
                    opponent.updateCenter();
                }
            }

            isDefeated() {
                return !this.partsData.some(p => p.type === 'body' && p.active);
            }

            draw(ctx) {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.scale(this.scale, this.scale);
                ctx.translate(0, -this.bottomOffset);
                
                if (this.dir === -1) ctx.scale(-1, 1);

                const drawOrder = ['equip', 'foot', 'body', 'hand'];
                
                drawOrder.forEach(type => {
                    this.partsData.filter(p => p.type === type && p.active).forEach(p => {
                        ctx.save();
                        ctx.translate(p.offsetX, p.offsetY);
                        if (p.animAngle !== 0) {
                            ctx.rotate(p.animAngle * this.dir);
                        }

                        const b = p.bounds || { minX: 320, maxX: 320, minY: 240, maxY: 240 };
                        const boundsCx = (b.minX + b.maxX) / 2;
                        const boundsCy = (b.minY + b.maxY) / 2;
                        ctx.translate(-boundsCx, -boundsCy);
                        
                        p.paths.forEach(path => {
                            // 注意: drawSmoothPathはqr_logic.js側で定義済みである必要があります。
                            if (typeof drawSmoothPath === 'function') {
                                drawSmoothPath(ctx, path);
                            }
                        });
                        
                        ctx.restore();
                    });
                });
                ctx.restore();

                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.scale(this.scale, this.scale);
                ctx.translate(0, -this.bottomOffset);

                drawOrder.forEach(type => {
                    this.partsData.filter(p => p.type === type && p.active).forEach(p => {
                        const barX = p.offsetX * this.dir;
                        const barY = p.offsetY - p.radius - 10;
                        ctx.fillStyle = 'red';
                        ctx.fillRect(barX - 20, barY, 40, 5);
                        ctx.fillStyle = 'green';
                        ctx.fillRect(barX - 20, barY, 40 * (p.hp / p.maxHp), 5);
                    });
                });
                ctx.restore();
            }
        }

        const p1 = new Fighter(myParts, 600, 1);
        const p2 = new Fighter(enemyParts, 2600, -1);
        let bullets = [];

        const loop = (time) => {
            const dt = Math.min((time - lastTime) / 1000, 0.05);
            lastTime = time;

            if (isEnded.current) return;

            // --- カウントダウン処理 ---
            timerAccumulator.current += dt;
            if (timerAccumulator.current >= 1.0 && timeLeftRef.current > 0) {
                timeLeftRef.current -= 1;
                timerAccumulator.current -= 1.0;
                setTimeLeft(timeLeftRef.current);
            }

            // --- タイムアップ時の勝敗判定 ---
            if (timeLeftRef.current <= 0 && !isEnded.current) {
                isEnded.current = true;
                
                const p1TotalMax = p1.totalMaxHp || 1;
                const p2TotalMax = p2.totalMaxHp || 1;
                
                const p1Ratio = p1.getCurrentHpSum() / p1TotalMax;
                const p2Ratio = p2.getCurrentHpSum() / p2TotalMax;

                let result = 'DRAW';
                if (p1Ratio > p2Ratio) result = 'WIN';
                else if (p1Ratio < p2Ratio) result = 'LOSE';

                setTimeout(() => {
                    onEnd(result);
                }, 1000);
                return;
            }

            p1.update(dt, p2, bullets);
            p2.update(dt, p1, bullets);

            let p1Destroyed = false;
            let p2Destroyed = false;

            bullets.forEach(b => {
                if (!b.active) return;
                b.x += b.vx * dt;
                b.y += b.vy * dt;
                if (b.x < -500 || b.x > 3700 || b.y < -1000 || b.y > 1000) b.active = false;

                const opponent = b.owner === p1 ? p2 : p1;
                opponent.partsData.forEach(op => {
                    if (!op.active || !b.active) return;
                    const dx = op.absX - b.x;
                    const dy = op.absY - b.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    
                    if (op.type === 'equip' && op.subType === 'melee' && dist < op.radius * opponent.scale) {
                        let dmgMult = calculateDamageMultiplier(b.rgb, op.rgb);
                        let finalDmg = b.power * dmgMult * 5 * 0.1;
                        op.hp -= finalDmg;
                        b.active = false;

                        if (op.hp <= 0) {
                            op.active = false;
                            if (opponent === p1) p1Destroyed = true;
                            else p2Destroyed = true;

                            opponent.vx += (b.vx > 0 ? 1 : -1) * 400;
                            opponent.vy = -300;
                        }
                        return;
                    }

                    if (dist < op.radius * opponent.scale) {
                        let dmgMult = calculateDamageMultiplier(b.rgb, op.rgb);
                        let finalDmg = b.power * dmgMult * 5;
                        op.hp -= finalDmg;
                        b.active = false;
                        
                        if (op.hp <= 0) {
                            op.active = false;
                            if (opponent === p1) p1Destroyed = true;
                            else p2Destroyed = true;

                            opponent.vx += (b.vx > 0 ? 1 : -1) * 400;
                            opponent.vy = -300;
                        }
                    }
                });
            });

            if (p1Destroyed) p1.updateCenter();
            if (p2Destroyed) p2.updateCenter();

            const dist = Math.abs(p2.x - p1.x);
            const maxDist = Math.max(dist, Math.abs(p2.y - p1.y) * 1.33);
            
            let targetScale = 800 / (maxDist + 400); 
            targetScale = Math.max(0.25, Math.min(1.2, targetScale)); 
            
            let targetX = (p1.x + p2.x) / 2;
            let targetY = (p1.y + p2.y) / 2;
            targetY = Math.min(FLOOR_Y - 200 / targetScale, targetY);

            camera.current.scale += (targetScale - camera.current.scale) * dt * 5;
            camera.current.x += (targetX - camera.current.x) * dt * 5;
            camera.current.y += (targetY - camera.current.y) * dt * 5;

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(camera.current.scale, camera.current.scale);
            ctx.translate(-camera.current.x, -camera.current.y);

            ctx.beginPath();
            ctx.moveTo(-1000, FLOOR_Y);
            ctx.lineTo(4200, FLOOR_Y);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.stroke();

            p1.draw(ctx);
            p2.draw(ctx);

            bullets.forEach(b => {
                if (!b.active) return;
                ctx.beginPath();
                ctx.fillStyle = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`;
                ctx.arc(b.x, b.y, b.size, 0, Math.PI*2);
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1;
                ctx.stroke();
            });

            ctx.restore();

            // 既存の勝敗判定（本体が破壊された場合）
            if ((p1.isDefeated() || p2.isDefeated()) && !isEnded.current) {
                isEnded.current = true;
                setTimeout(() => {
                    onEnd(p1.isDefeated() && p2.isDefeated() ? 'DRAW' : p1.isDefeated() ? 'LOSE' : 'WIN');
                }, 1000);
                return;
            }

            animationId = requestAnimationFrame(loop);
        };

        animationId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(animationId);
    }, [myParts, enemyParts, onEnd]);

    return (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 relative">
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 text-white text-5xl font-bold font-mono z-10 timer-text pointer-events-none">
                {timeLeft}
            </div>
            <canvas ref={canvasRef} width={800} height={600} className="bg-white rounded-lg shadow-2xl max-w-full" style={{aspectRatio: '4/3'}}></canvas>
        </div>
    );
};

// --- Result Screen ---
const ResultScreen = ({ result, onTitle, onMode }) => (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-4">
        <h1 className={`text-6xl font-extrabold mb-12 drop-shadow-md ${result === 'WIN' ? 'text-yellow-500' : result === 'LOSE' ? 'text-blue-800' : 'text-gray-500'}`}>
            {result === 'WIN' ? 'YOU WIN!!' : result === 'LOSE' ? 'YOU LOSE...' : 'DRAW'}
        </h1>
        <div className="flex flex-col gap-4 w-64">
            <button onClick={onMode} className="ui-btn py-4 text-xl">もう一度戦う</button>
            <button onClick={onTitle} className="ui-btn py-4 text-xl bg-gray-200">タイトルへ</button>
        </div>
    </div>
);

// グローバルスコープにコンポーネントをエクスポートする
window.MatchScreen = MatchScreen;
window.BattleScreen = BattleScreen;
window.ResultScreen = ResultScreen;
window.calculateDamageMultiplier = calculateDamageMultiplier;
