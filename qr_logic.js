// --- Utils & Constants ---
const COLORS = {
    black: '#000000', red: '#EF4444', green: '#22C55E', blue: '#3B82F6'
};
const WIDTH_OPTIONS = [4, 10, 16, 24]; // 線幅の固定段階

let globalIdCounter = 1;
const generateId = () => `${globalIdCounter++}`;

// ベジェ曲線描画ユーティリティ
const drawSmoothPath = (ctx, path) => {
    if (!path.p || path.p.length === 0) return;
    ctx.beginPath();
    ctx.strokeStyle = path.c;
    ctx.lineWidth = path.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.moveTo(path.p[0][0], path.p[0][1]);
    if (path.p.length === 1) {
        ctx.lineTo(path.p[0][0], path.p[0][1]);
    } else if (path.p.length === 2) {
        ctx.lineTo(path.p[1][0], path.p[1][1]);
    } else {
        for (let i = 1; i < path.p.length - 1; i++) {
            const xc = (path.p[i][0] + path.p[i + 1][0]) / 2;
            const yc = (path.p[i][1] + path.p[i + 1][1]) / 2;
            ctx.quadraticCurveTo(path.p[i][0], path.p[i][1], xc, yc);
        }
        ctx.lineTo(path.p[path.p.length - 1][0], path.p[path.p.length - 1][1]);
    }
    ctx.stroke();
};

const computePartData = (part) => {
    if (!part.paths || part.paths.length === 0) {
        return { ...part, pixels: 0, rgb: [0,0,0], bounds: { minX: 320, maxX: 320, minY: 240, maxY: 240 } };
    }
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let minX = 640, maxX = 0, minY = 480, maxY = 0;

    part.paths.forEach(p => {
        drawSmoothPath(ctx, p);
        if (p.p && p.p.length > 0) {
            p.p.forEach(point => {
                if (point[0] < minX) minX = point[0];
                if (point[0] > maxX) maxX = point[0];
                if (point[1] < minY) minY = point[1];
                if (point[1] > maxY) maxY = point[1];
            });
        }
    });

    const imgData = ctx.getImageData(0, 0, 640, 480);
    let pixels = 0, rSum = 0, gSum = 0, bSum = 0;

    for (let i = 0; i < imgData.data.length; i += 4) {
        if (imgData.data[i+3] > 0) {
            pixels++;
            rSum += imgData.data[i];
            gSum += imgData.data[i+1];
            bSum += imgData.data[i+2];
        }
    }

    if (pixels === 0) {
        return { ...part, pixels: 0, rgb: [0,0,0], bounds: { minX: 320, maxX: 320, minY: 240, maxY: 240 } };
    }

    return {
        ...part,
        pixels,
        rgb: [Math.round(rSum/pixels), Math.round(gSum/pixels), Math.round(bSum/pixels)],
        bounds: { minX, maxX, minY, maxY }
    };
};

// --- Ramer-Douglas-Peucker (RDP) Algorithm ---
const pointSqDist = (p, p1, p2) => {
    let x = p1[0], y = p1[1], dx = p2[0] - x, dy = p2[1] - y;
    if (dx !== 0 || dy !== 0) {
        const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = p2[0]; y = p2[1]; }
        else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
};

const simplifyDPStep = (points, first, last, sqTolerance, simplified) => {
    let maxSqDist = sqTolerance, index = -1;
    for (let i = first + 1; i < last; i++) {
        const sqDist = pointSqDist(points[i], points[first], points[last]);
        if (sqDist > maxSqDist) { index = i; maxSqDist = sqDist; }
    }
    if (index > -1) {
        if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
        simplified.push(points[index]);
        if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
};

const simplifyPath = (points, tolerance) => {
    if (points.length <= 2) return points;
    const sqTolerance = tolerance * tolerance;
    const simplified = [points[0]];
    simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
    simplified.push(points[points.length - 1]);
    return simplified;
};

// --- V7 Ultimate Bezier + Int8 Delta Compression (Only V7 Kept) ---
const compressDataV7 = (parts) => {
    const TYPE_MAP = { 'body':0, 'hand':1, 'foot':2, 'equip':3 };
    const SUB_MAP = { '':0, 'walk':1, 'wheel':2, 'fly':3, 'melee':4, 'shoot':5, 'shield':6 };
    const COLOR_ARR = Object.values(COLORS);
    
    const idMap = new Map();
    let mappedCounter = 1;
    parts.forEach(p => { idMap.set(p.id, mappedCounter++); });

    const buffer = new ArrayBuffer(500000); 
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint8(offset++, 86); // 'V'
    view.setUint8(offset++, 55); // '7'
    view.setUint8(offset++, parts.length);

    parts.forEach(p => {
        const mappedId = idMap.get(p.id);
        const t = TYPE_MAP[p.type];
        const s = SUB_MAP[p.subType];
        const a = p.attachedTo ? (idMap.get(p.attachedTo) || 0) : 0;
        const f = p.flipX ? 1 : 0;

        view.setUint8(offset++, mappedId);
        view.setUint8(offset++, t | (s << 2) | (f << 5));
        view.setUint8(offset++, a);

        const styleGroups = {};
        p.paths.forEach(path => {
            if (path.p.length === 0) return;
            
            const wIdx = path.wIdx !== undefined ? path.wIdx : 1;
            const w = WIDTH_OPTIONS[wIdx] || 10;
            
            let simplified;
            const tolerance = w >= 20 ? 3.0 : w >= 10 ? 2.0 : 1.0;

            if (path.p.length < 5) {
                simplified = path.p; 
            } else {
                simplified = simplifyPath(path.p, tolerance);
            }
            
            const deduplicated = [];
            let lastQ = null;
            simplified.forEach(pt => {
                const q = [Math.round(pt[0]), Math.round(pt[1])];
                if (!lastQ || q[0] !== lastQ[0] || q[1] !== lastQ[1]) {
                    deduplicated.push(q);
                    lastQ = q;
                }
            });

            if (deduplicated.length > 0) {
                const styleKey = `${COLOR_ARR.indexOf(path.c)}_${wIdx}`;
                if (!styleGroups[styleKey]) styleGroups[styleKey] = [];
                styleGroups[styleKey].push(deduplicated);
            }
        });

        const styleKeys = Object.keys(styleGroups);
        view.setUint8(offset++, styleKeys.length);

        styleKeys.forEach(key => {
            const [cIdx, wIdx] = key.split('_').map(Number);
            view.setUint8(offset++, cIdx | (wIdx << 4));

            const paths = styleGroups[key];
            const ptsData = [];
            
            paths.forEach((pts, pathIdx) => {
                if (pathIdx > 0) {
                    ptsData.push(128, 128); // MoveTo Escape Command (-128 in Int8)
                }
                
                let lastX = pts[0][0];
                let lastY = pts[0][1];
                
                ptsData.push((lastX >> 8) & 0xFF, lastX & 0xFF);
                ptsData.push((lastY >> 8) & 0xFF, lastY & 0xFF);

                for(let i=1; i<pts.length; i++) {
                    let dx = pts[i][0] - lastX;
                    let dy = pts[i][1] - lastY;
                    
                    while (dx !== 0 || dy !== 0) {
                        let stepX = dx > 127 ? 127 : dx < -127 ? -127 : dx;
                        let stepY = dy > 127 ? 127 : dy < -127 ? -127 : dy;

                        if (stepX === -128 && stepY === -128) stepX = -127;

                        ptsData.push(stepX & 0xFF, stepY & 0xFF);
                        
                        lastX += stepX;
                        lastY += stepY;
                        dx -= stepX;
                        dy -= stepY;
                    }
                }
            });

            view.setUint32(offset, ptsData.length, true);
            offset += 4;
            ptsData.forEach(b => { view.setUint8(offset++, b); });
        });
    });

    const finalArray = new Uint8Array(buffer, 0, offset);
    return window.pako.deflate(finalArray);
};

const decompressDataV7 = (uint8Array) => {
    const INV_TYPE = { 0:'body', 1:'hand', 2:'foot', 3:'equip' };
    const INV_SUB = { 0:'', 1:'walk', 2:'wheel', 3:'fly', 4:'melee', 5:'shoot', 6:'shield' };
    const COLOR_ARR = Object.values(COLORS);

    const view = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    let offset = 0;

    const v1 = view.getUint8(offset++);
    const v2 = view.getUint8(offset++);
    if (v1 !== 86 || v2 !== 55) return null; // 'V7'

    const numParts = view.getUint8(offset++);
    const parts = [];
    const idMap = new Map();

    for(let i=0; i<numParts; i++) {
        const mappedId = view.getUint8(offset++);
        const realId = generateId();
        idMap.set(mappedId, realId);

        const flags = view.getUint8(offset++);
        const t = flags & 0x03;
        const s = (flags >> 2) & 0x07;
        const f = ((flags >> 5) & 0x01) === 1;

        const a = view.getUint8(offset++);
        const numStyles = view.getUint8(offset++);

        const paths = [];
        for(let j=0; j<numStyles; j++) {
            const style = view.getUint8(offset++);
            const cIdx = style & 0x0F;
            const wIdx = (style >> 4) & 0x03;

            const dataLen = view.getUint32(offset, true);
            offset += 4;

            const endOffset = offset + dataLen;
            let currentPath = [];
            let currX = 0, currY = 0;
            let isNewPath = true;

            while (offset < endOffset) {
                if (isNewPath) {
                    currX = (view.getUint8(offset++) << 8) | view.getUint8(offset++);
                    currY = (view.getUint8(offset++) << 8) | view.getUint8(offset++);
                    currentPath = [[currX, currY]];
                    isNewPath = false;
                } else {
                    const dx = view.getInt8(offset++);
                    const dy = view.getInt8(offset++);
                    if (dx === -128 && dy === -128) {
                        // MoveTo Command
                        if (currentPath.length > 0) {
                            paths.push({ c: COLOR_ARR[cIdx], wIdx: wIdx, w: WIDTH_OPTIONS[wIdx], p: currentPath });
                        }
                        isNewPath = true;
                    } else {
                        currX += dx;
                        currY += dy;
                        currentPath.push([currX, currY]);
                    }
                }
            }
            if (currentPath.length > 0) {
                paths.push({ c: COLOR_ARR[cIdx], wIdx: wIdx, w: WIDTH_OPTIONS[wIdx], p: currentPath });
            }
        }

        parts.push({ tempMappedId: mappedId, tempAttachedTo: a, id: realId, type: INV_TYPE[t], subType: INV_SUB[s], flipX: f, paths: paths });
    }

    parts.forEach(p => {
        p.attachedTo = p.tempAttachedTo === 0 ? null : (idMap.get(p.tempAttachedTo) || null);
        delete p.tempMappedId;
        delete p.tempAttachedTo;
    });
    return parts;
};

const scanQRFromImage = (img, onSuccess, onError) => {
    if (typeof window.jsQR === 'undefined') {
        onError("QR読込機能の準備ができていません。\nページを再読み込みしてください。");
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    
    const tryDecode = (x, y, w, h) => {
        try {
            const d = ctx.getImageData(x, y, w, h);
            return window.jsQR(d.data, d.width, d.height);
        } catch(e) { return null; }
    };

    let code = tryDecode(0, 0, canvas.width, canvas.height);
    // 左側領域スキャン（QRは左にある想定）
    if (!code) code = tryDecode(0, 0, canvas.width * 0.6, canvas.height);
    if (!code) {
        const sCanvas = document.createElement('canvas');
        sCanvas.width = canvas.width / 2;
        sCanvas.height = canvas.height / 2;
        const sCtx = sCanvas.getContext('2d', { willReadFrequently: true });
        sCtx.drawImage(canvas, 0, 0, sCanvas.width, sCanvas.height);
        try {
            const d = sCtx.getImageData(0, 0, sCanvas.width * 0.6, sCanvas.height);
            code = window.jsQR(d.data, d.width, d.height);
        } catch(e) {}
    }

    if (code) {
        try {
            let parsed = null;

            if (code.binaryData && code.binaryData.length > 0 && typeof window.pako !== 'undefined') {
                try {
                    const uint8 = new Uint8Array(code.binaryData);
                    const inflated = window.pako.inflate(uint8);
                    // 最新のV7フォーマットのみ解読
                    if (inflated[0] === 86 && inflated[1] === 55) {
                        parsed = decompressDataV7(inflated);
                    }
                } catch(e) { }
            }

            if (!parsed) {
                throw new Error("フォーマットが一致しませんでした。(古いバージョンのQRはサポート外です)");
            }

            const restoredParts = parsed.map(p => computePartData(p));
            onSuccess(restoredParts);
        } catch(err) {
            onError("データの復元に失敗しました。(データ破損)\n" + err.message);
        }
    } else {
        onError("生成に失敗しました…。(QRコードが見つかりません)\n※画像がぼやけているか、光の反射などが影響している可能性があります。");
    }
};
