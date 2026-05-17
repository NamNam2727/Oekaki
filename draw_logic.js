(function() {
    const { useState, useEffect, useRef, useCallback } = React;

    // --- モーダルコンポーネント ---
    const Modal = ({ text, onOk, onCancel, okText="🆗", cancelText="🆖" }) => (
        <div className="modal-overlay">
            <div className="modal-content">
                <p className="text-xl font-bold mb-6 whitespace-pre-wrap">{text}</p>
                <div className="flex justify-center gap-4">
                    {onOk && <button onClick={onOk} className="ui-btn w-24 text-2xl">{okText}</button>}
                    {onCancel && <button onClick={onCancel} className="ui-btn w-24 text-2xl">{cancelText}</button>}
                </div>
            </div>
        </div>
    );

    // --- お絵描き画面のメインロジック ---
    window.DrawScreen = ({ onComplete }) => {
        const canvasRef = useRef(null);
        const [parts, setParts] = useState([]);
        const [selectedPartId, setSelectedPartId] = useState(null);
        
        const [color, setColor] = useState('#000000'); 
        const [customColor, setCustomColor] = useState(null); 
        
        const [lineWidthIdx, setLineWidthIdx] = useState(1); 
        
        const [rightMenuMode, setRightMenuMode] = useState('body');
        const [showConfirm, setShowConfirm] = useState(null);
        const [showSubMenu, setShowSubMenu] = useState(null);
        const [tempTarget, setTempTarget] = useState(null);
        const [generatedImage, setGeneratedImage] = useState(null);
        const [errorMsg, setErrorMsg] = useState('');

        const [currentSize, setCurrentSize] = useState(0);
        const [inkWarning, setInkWarning] = useState(false);
        const previousParts = useRef(null); 
        
        // --- 他人の機体の再保存禁止フラグ ---
        const [isSaveDisabled, setIsSaveDisabled] = useState(false);

        const isDrawing = useRef(false);
        const currentPath = useRef(null);
        const lastPos = useRef(null);
        const drawingPartId = useRef(null);

        useEffect(() => {
            if (parts.length === 0) {
                const initId = typeof generateId !== 'undefined' ? generateId() : '1'; 
                setParts([{ id: initId, type: 'body', subType: '', attachedTo: null, paths: [], flipX: false }]);
                setSelectedPartId(initId);
                setIsSaveDisabled(false); 
            }
        }, []);

        useEffect(() => {
            if (isDrawing.current) return;
            if (typeof compressDataV7 !== 'undefined') {
                try {
                    const size = compressDataV7(parts).length;
                    setCurrentSize(size);
                } catch(e) {}
            }
        }, [parts]);

        useEffect(() => {
            if (inkWarning) {
                const timer = setTimeout(() => setInkWarning(false), 3000);
                return () => clearTimeout(timer);
            }
        }, [inkWarning]);

        const handleColorPick = (e) => {
            const newColor = e.target.value.toLowerCase();
            setColor(newColor);
            setCustomColor(newColor);
        };

        const redraw = useCallback(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            parts.forEach(part => {
                const isSelected = part.id === selectedPartId;
                const isAnySelected = selectedPartId !== null;
                
                ctx.save();
                if (isAnySelected && !isSelected) {
                    ctx.globalAlpha = 0.3;
                } else {
                    ctx.globalAlpha = 1.0;
                }

                if (part.flipX) {
                    ctx.translate(canvas.width, 0);
                    ctx.scale(-1, 1);
                }

                part.paths.forEach(p => {
                    if (typeof drawSmoothPath !== 'undefined') {
                        drawSmoothPath(ctx, p); 
                    }
                });
                ctx.restore();
            });
        }, [parts, selectedPartId]);

        useEffect(() => { redraw(); }, [redraw]);

        const getPointerPos = (e, targetId) => {
            const canvas = canvasRef.current;
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            let clientX, clientY;
            if (e.touches) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }
            let x = (clientX - rect.left) * scaleX;
            let y = (clientY - rect.top) * scaleY;
            
            const activePart = parts.find(p => p.id === targetId);
            if (activePart && activePart.flipX) {
                x = canvas.width - x;
            }
            return [Math.round(x), Math.round(y)];
        };

        const handlePointerDown = (e) => {
            if (showConfirm || showSubMenu || generatedImage) return;

            previousParts.current = JSON.parse(JSON.stringify(parts));
            
            let targetId = selectedPartId;

            if (!targetId) {
                if (rightMenuMode === 'equip') {
                    setTempTarget(null);
                    setShowSubMenu('equipType');
                    return;
                }
                targetId = typeof generateId !== 'undefined' ? generateId() : Date.now().toString(); 
                const newPart = { id: targetId, type: rightMenuMode, subType: '', attachedTo: null, paths: [], flipX: false };
                setParts(prev => [...prev, newPart]);
                setSelectedPartId(targetId);
            }

            isDrawing.current = true;
            drawingPartId.current = targetId;
            const pos = getPointerPos(e, targetId);
            const wOptions = typeof WIDTH_OPTIONS !== 'undefined' ? WIDTH_OPTIONS : [4, 10, 16, 24];
            currentPath.current = { c: color, wIdx: lineWidthIdx, w: wOptions[lineWidthIdx], p: [pos] }; 
            lastPos.current = pos;
            
            setParts(prev => prev.map(p => 
                p.id === targetId ? { ...p, paths: [...p.paths, currentPath.current] } : p
            ));
        };

        const handlePointerMove = (e) => {
            if (!isDrawing.current || !drawingPartId.current) return;
            const targetId = drawingPartId.current;
            const pos = getPointerPos(e, targetId);
            
            const dx = pos[0] - lastPos.current[0];
            const dy = pos[1] - lastPos.current[1];
            if (dx*dx + dy*dy > 25) {
                currentPath.current.p.push(pos);
                lastPos.current = pos;
                redraw(); 
                
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                ctx.save();
                const activePart = parts.find(p => p.id === targetId);
                if (activePart && activePart.flipX) {
                    ctx.translate(canvas.width, 0);
                    ctx.scale(-1, 1);
                }
                ctx.beginPath();
                ctx.strokeStyle = currentPath.current.c;
                ctx.lineWidth = currentPath.current.w;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                const len = currentPath.current.p.length;
                if(len >= 2) {
                    ctx.moveTo(currentPath.current.p[len-2][0], currentPath.current.p[len-2][1]);
                    ctx.lineTo(pos[0], pos[1]);
                    ctx.stroke();
                }
                ctx.restore();
            }
        };

        const handlePointerUp = () => {
            if(isDrawing.current) {
                isDrawing.current = false;
                drawingPartId.current = null;
                
                if (typeof compressDataV7 !== 'undefined') {
                    try {
                        const size = compressDataV7(parts).length;
                        if (size > 2300) {
                            setInkWarning(true); 
                            const fallbackParts = previousParts.current;
                            setParts(fallbackParts); 
                            
                            let newSelectedId = selectedPartId;
                            if (selectedPartId && !fallbackParts.some(p => p.id === selectedPartId)) {
                                newSelectedId = null;
                                setSelectedPartId(null);
                            }
                            
                            const canvas = canvasRef.current;
                            if (canvas) {
                                const ctx = canvas.getContext('2d');
                                ctx.clearRect(0, 0, canvas.width, canvas.height);
                                fallbackParts.forEach(part => {
                                    const isSelected = part.id === newSelectedId;
                                    const isAnySelected = newSelectedId !== null;
                                    
                                    ctx.save();
                                    if (isAnySelected && !isSelected) {
                                        ctx.globalAlpha = 0.3;
                                    } else {
                                        ctx.globalAlpha = 1.0;
                                    }
                                    if (part.flipX) {
                                        ctx.translate(canvas.width, 0);
                                        ctx.scale(-1, 1);
                                    }
                                    part.paths.forEach(p => {
                                        if (typeof drawSmoothPath !== 'undefined') {
                                            drawSmoothPath(ctx, p); 
                                        }
                                    });
                                    ctx.restore();
                                });
                            }
                            return;
                        }
                    } catch(e) {}
                }
                
                setParts([...parts]); 
            }
        };

        const undo = () => {
            if (!selectedPartId) return;
            setParts(prev => prev.map(p => {
                if (p.id === selectedPartId && p.paths.length > 0) {
                    return { ...p, paths: p.paths.slice(0, -1) };
                }
                return p;
            }));
        };

        const cancelEdit = () => {
            if (!selectedPartId) return;
            setShowConfirm({ text: "現在描いている部位を削除しますがよろしいですか？", action: 'delete' });
        };

        const okEdit = () => {
            if (!selectedPartId) return;
            if (typeof computePartData !== 'undefined') {
                setParts(prev => prev.map(p => p.id === selectedPartId ? computePartData(p) : p)); 
            }
            setSelectedPartId(null);
        };

        const flipImage = () => {
            if (selectedPartId) {
                setParts(prev => prev.map(p => p.id === selectedPartId ? { ...p, flipX: !p.flipX } : p));
            } else {
                setParts(prev => prev.map(p => ({ ...p, flipX: !p.flipX })));
            }
        };

        const cleanupEmptyParts = (currentParts, keepId) => {
            return currentParts.filter(p => {
                if (p.id === keepId) return true;
                return p.paths && p.paths.some(path => path.p && path.p.length > 0);
            });
        };

        const changeMenuMode = (type) => {
            setParts(prev => cleanupEmptyParts(prev, null));
            setRightMenuMode(type);
            setSelectedPartId(null);
        };

        const addPart = (type, subType='', attachedTo=null) => {
            const id = typeof generateId !== 'undefined' ? generateId() : Date.now().toString(); 
            setParts(prev => {
                let newParts = cleanupEmptyParts(prev, null);
                if (type === 'equip' && attachedTo) {
                    newParts = newParts.map(p => 
                        (p.type === 'equip' && p.attachedTo === attachedTo) ? { ...p, attachedTo: null } : p
                    );
                }
                return [...newParts, { id, type, subType, attachedTo, paths: [], flipX: false }];
            });
            setSelectedPartId(id);
            setRightMenuMode(type);
        };

        const selectPart = (id) => {
            setParts(prev => cleanupEmptyParts(prev, id));
            setSelectedPartId(id);
            const p = parts.find(x => x.id === id);
            if(p) setRightMenuMode(p.type);
        };

        const handleEquipSelectFromHand = (equipId) => {
            if(!selectedPartId) return;
            setParts(prev => prev.map(p => {
                if (p.type === 'equip' && p.attachedTo === selectedPartId && p.id !== equipId) {
                    return { ...p, attachedTo: null };
                }
                if (p.id === equipId) {
                    return { ...p, attachedTo: selectedPartId };
                }
                return p;
            }));
        };

        const checkHasValidBody = () => {
            return parts.some(p => p.type === 'body' && p.paths && p.paths.some(path => path.p && path.p.length > 0));
        };

        const handleFinishDraw = () => {
            if (!checkHasValidBody()) {
                setErrorMsg("最低でも1つは身体を描いてください");
                setShowSubMenu('error');
                return;
            }
            setShowConfirm({ text: "お絵描きを完了しますか？", action: 'finish' });
        };

        const handleQRMenu = () => {
            setShowSubMenu('qr');
        };

        const handleSaveQR = () => {
            if (isSaveDisabled) {
                setErrorMsg("他のプレイヤーの作品は保存できません。");
                setShowSubMenu('error');
                return;
            }
            if (!checkHasValidBody()) {
                setErrorMsg("最低でも1つは身体を描いてください");
                setShowSubMenu('error');
                return;
            }

            setShowSubMenu('loading');
            
            setTimeout(async () => {
                try {
                    if (typeof window.QRCode === 'undefined') {
                        throw new Error("QRコード生成機能の準備ができていません。\n通信環境を確認し、ページを再読み込みしてください。");
                    }
                    if (typeof window.pako === 'undefined') {
                        throw new Error("データ圧縮機能(pako)の準備ができていません。\n通信環境を確認し、ページを再読み込みしてください。");
                    }
                    if (typeof compressDataV7 === 'undefined') {
                        throw new Error("外部スクリプトの読み込みが完了していません。\nページを再読み込みしてください。");
                    }

                    const deflatedUint8 = compressDataV7(parts); 
                    if (deflatedUint8.length > 2300) {
                        throw new Error(`絵の線が多すぎます。\n少し線を消してシンプルな絵にしてください。\n(現在データ量: ${deflatedUint8.length} bytes / 上限目安: 2300 bytes)`);
                    }

                    let finalBinary = deflatedUint8;
                    const isGravity = window.UserData && window.UserData.id !== 'local_guest';
                    
                    if (isGravity) {
                        const headerStr = `GRV:${window.UserData.id}|`;
                        const encoder = new TextEncoder();
                        const headerBytes = encoder.encode(headerStr);
                        finalBinary = new Uint8Array(headerBytes.length + deflatedUint8.length);
                        finalBinary.set(headerBytes, 0);
                        finalBinary.set(deflatedUint8, headerBytes.length);
                    }

                    const qrCanvas = document.createElement('canvas');
                    await window.QRCode.toCanvas(qrCanvas, [{ data: finalBinary, mode: 'byte' }], { errorCorrectionLevel: 'L', margin: 4, width: 800 });
                    
                    const imgCanvas = document.createElement('canvas');
                    imgCanvas.width = 640;
                    imgCanvas.height = 480;
                    const imgCtx = imgCanvas.getContext('2d');
                    imgCtx.fillStyle = '#ffffff';
                    imgCtx.fillRect(0, 0, 640, 480);
                    
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

                    parts.forEach(part => {
                        imgCtx.save();
                        if (part.flipX) {
                            imgCtx.translate(640, 0);
                            imgCtx.scale(-1, 1);
                        }
                        part.paths.forEach(p => {
                            const w = p.w || 10;
                            p.p.forEach(pos => {
                                let px = pos[0];
                                let py = pos[1];
                                if (part.flipX) px = 640 - px;
                                if (px - w < minX) minX = px - w;
                                if (px + w > maxX) maxX = px + w;
                                if (py - w < minY) minY = py - w;
                                if (py + w > maxY) maxY = py + w;
                            });
                            if (typeof drawSmoothPath !== 'undefined') {
                                drawSmoothPath(imgCtx, p); 
                            }
                        });
                        imgCtx.restore();
                    });

                    // 絵が描かれている範囲（バウンディングボックス）の算出と余白確保
                    if (minX > maxX) {
                        minX = 0; maxX = 640; minY = 0; maxY = 480;
                    } else {
                        minX = Math.max(0, minX - 10);
                        maxX = Math.min(640, maxX + 10);
                        minY = Math.max(0, minY - 10);
                        maxY = Math.min(480, maxY + 10);
                    }
                    const cropW = maxX - minX;
                    const cropH = maxY - minY;

                    const compositeCanvas = document.createElement('canvas');
                    compositeCanvas.width = 1560;
                    compositeCanvas.height = 880;
                    const compCtx = compositeCanvas.getContext('2d');
                    
                    compCtx.fillStyle = '#ffffff';
                    compCtx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
                    
                    compCtx.drawImage(qrCanvas, 40, 40); 
                    
                    // 絵をトリミングしてアスペクト比を維持しつつ右枠内に描画
                    const targetW = 640;
                    const targetH = 640;
                    const scale = Math.min(targetW / cropW, targetH / cropH, 1.5);
                    const finalW = cropW * scale;
                    const finalH = cropH * scale;
                    const drawX = 880 + (targetW - finalW) / 2;
                    const drawY = 160 + (targetH - finalH) / 2; // アイコン配置用にY軸を下げる
                    
                    compCtx.drawImage(imgCanvas, minX, minY, cropW, cropH, drawX, drawY, finalW, finalH); 
                    
                    // ユーザー情報の高さを揃えて配置
                    const textCenterY = 80;
                    compCtx.fillStyle = '#000000';
                    compCtx.textAlign = 'center';
                    compCtx.textBaseline = 'middle';
                    compCtx.font = 'bold 40px sans-serif';
                    compCtx.fillText("お絵描きデータ", 440, textCenterY);

                    if (isGravity && window.UserData) {
                        compCtx.font = 'bold 36px sans-serif';
                        const nameWidth = compCtx.measureText(window.UserData.name).width;
                        
                        let totalWidth = nameWidth;
                        let iconImg = null;
                        if (window.UserData.portrait) {
                            iconImg = new Image();
                            iconImg.crossOrigin = "Anonymous"; 
                            await new Promise((resolve) => {
                                iconImg.onload = () => resolve();
                                iconImg.onerror = () => { iconImg = null; resolve(); };
                                iconImg.src = window.UserData.portrait;
                            });
                            if (iconImg) {
                                totalWidth += 48 + 16;
                            }
                        }
                        
                        // 右枠（880から幅640のエリア）の中央に揃える
                        let startX = 880 + 320 - (totalWidth / 2);
                        
                        compCtx.fillStyle = '#333';
                        if (iconImg) {
                            compCtx.save();
                            compCtx.beginPath();
                            compCtx.arc(startX + 24, textCenterY, 24, 0, Math.PI * 2);
                            compCtx.closePath();
                            compCtx.clip();
                            compCtx.drawImage(iconImg, startX, textCenterY - 24, 48, 48);
                            compCtx.restore();
                            
                            compCtx.textAlign = 'left';
                            compCtx.fillText(window.UserData.name, startX + 64, textCenterY);
                        } else {
                            compCtx.textAlign = 'center';
                            compCtx.fillText(window.UserData.name, 880 + 320, textCenterY);
                        }
                    }
                    
                    const finalUrl = compositeCanvas.toDataURL('image/png');
                    
                    setShowSubMenu(null);
                    setGeneratedImage(finalUrl);

                } catch(e) {
                    setErrorMsg(e.message);
                    setShowSubMenu('error');
                }
            }, 100);
        };

        const handleLoadQR = (e) => {
            const file = e.target.files[0];
            if(!file) return;
            
            if (typeof scanQRFromImage === 'undefined' || typeof window.jsQR === 'undefined') {
                setErrorMsg("外部スクリプトの読み込みが完了していません。\nページを再読み込みしてください。");
                setShowSubMenu('error');
                return;
            }

            setShowSubMenu('loading'); 

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = async () => {
                    let targetImgForScan = img;
                    let qrId = null;

                    try {
                        const tmpCanvas = document.createElement('canvas');
                        const tmpCtx = tmpCanvas.getContext('2d');
                        tmpCanvas.width = img.width;
                        tmpCanvas.height = img.height;
                        tmpCtx.drawImage(img, 0, 0);
                        const imgData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
                        
                        const code = window.jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "dontInvert" });
                        
                        if (code && code.binaryData) {
                            const binary = new Uint8Array(code.binaryData);
                            const decoder = new TextDecoder();
                            const previewStr = decoder.decode(binary.subarray(0, Math.min(100, binary.length)));
                            
                            if (previewStr.startsWith("GRV:")) {
                                const sepIdx = previewStr.indexOf("|");
                                if (sepIdx !== -1) {
                                    qrId = previewStr.substring(4, sepIdx);
                                    const encoder = new TextEncoder();
                                    const headerBytesLength = encoder.encode(previewStr.substring(0, sepIdx + 1)).length;
                                    const v7Binary = binary.slice(headerBytesLength);
                                    
                                    const tempQrCanvas = document.createElement('canvas');
                                    await window.QRCode.toCanvas(tempQrCanvas, [{ data: v7Binary, mode: 'byte' }], { errorCorrectionLevel: 'L', margin: 4, width: 800 });
                                    
                                    targetImgForScan = new Image();
                                    await new Promise(resolve => {
                                        targetImgForScan.onload = resolve;
                                        targetImgForScan.src = tempQrCanvas.toDataURL();
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        console.warn("QRメタデータチェックスキップ:", e);
                    }

                    scanQRFromImage(targetImgForScan, 
                        (restoredParts) => {
                            setParts(restoredParts);
                            setSelectedPartId(null);
                            setShowSubMenu(null);
                            
                            if (qrId !== null && window.UserData && qrId !== window.UserData.id) {
                                setIsSaveDisabled(true); 
                            } else {
                                setIsSaveDisabled(false); 
                            }
                        }, 
                        (errorMsg) => {
                            setErrorMsg(errorMsg);
                            setShowSubMenu('error');
                        }
                    );
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        };

        const activeFootPart = rightMenuMode === 'foot' && selectedPartId ? parts.find(p => p.id === selectedPartId) : null;
        const footIcon = activeFootPart ? (activeFootPart.subType === 'walk' ? '🚶' : activeFootPart.subType === 'wheel' ? '⚙️' : activeFootPart.subType === 'fly' ? '🪽' : '') : '';
        
        const allEquipsForNum = parts.filter(p => p.type === 'equip');
        const activeHandEquips = rightMenuMode === 'hand' && selectedPartId ? allEquipsForNum.map((p, idx) => ({...p, equipIndex: idx})).filter(p => p.attachedTo === selectedPartId) : [];
        const handEquipDisplay = activeHandEquips.length > 0 ? activeHandEquips.map(p => {
            const icon = p.subType === 'melee' ? '🗡️' : p.subType === 'shoot' ? '🔫' : '🛡️';
            const num = ['①','②','③','④','⑤','⑥','⑦','⑧'][p.equipIndex] || (p.equipIndex + 1);
            return `${icon}${num}`;
        }).join(', ') : '';

        return (
            <div className="flex flex-col h-full bg-gray-100">
                <div className="bg-white shadow z-10 p-2 flex flex-col items-center shrink-0">
                    <div className="w-full max-w-md flex items-center justify-between text-xs font-bold text-gray-600 mb-1 px-1">
                        <span>インク残量</span>
                        <span className={currentSize > 2000 ? "text-red-500" : ""}>{currentSize} / 2300</span>
                    </div>
                    <div className="w-full max-w-md h-3 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                            className={`h-full transition-all duration-300 ${currentSize > 2000 ? 'bg-red-500' : 'bg-blue-500'}`} 
                            style={{ width: `${Math.min(100, (currentSize / 2300) * 100)}%` }}
                        ></div>
                    </div>
                </div>
                
                <div className="flex flex-1 overflow-hidden relative">
                    <div className="flex-1 flex flex-col p-2 min-w-0 overflow-y-auto pb-4">
                        <div className="canvas-container flex-1 shrink min-h-0"
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerLeave={handlePointerUp}>
                            <canvas ref={canvasRef} width={640} height={480}></canvas>
                        </div>

                        <div className="flex-none mt-2 p-2 bg-white rounded-lg shadow flex flex-col gap-2 shrink-0 z-10 relative">
                            <div className="flex justify-center gap-2 h-9 w-full">
                                {rightMenuMode === 'hand' && selectedPartId ? (
                                    <button className="ui-btn py-1 px-4 text-sm w-full h-full" onClick={() => setShowSubMenu('equipListForHand')}>
                                        [装備]を持たせる {handEquipDisplay && <span className="ml-1 font-bold text-blue-600">{handEquipDisplay}</span>}
                                    </button>
                                ) : rightMenuMode === 'foot' && selectedPartId ? (
                                    <button className="ui-btn py-1 px-4 text-sm w-full h-full" onClick={() => setShowSubMenu('footType')}>
                                        [機能]変更 {footIcon && <span className="ml-1">{footIcon}</span>}
                                    </button>
                                ) : (
                                    <div className="w-full h-full"></div>
                                )}
                            </div>

                            <div className="flex justify-between items-center overflow-x-auto pb-1">
                                <div className="flex gap-2 items-center flex-1 pr-2">
                                    <div 
                                        className={`color-btn shrink-0 w-6 h-6 sm:w-8 sm:h-8 ${color === '#000000' ? 'active' : ''}`} 
                                        style={{backgroundColor: '#000000'}} 
                                        onClick={() => setColor('#000000')} 
                                    />
                                    
                                    <div className="relative shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full border-2 border-gray-300 flex items-center justify-center bg-gradient-to-br from-red-500 via-green-500 to-blue-500 overflow-hidden cursor-pointer shadow-sm">
                                        <span className="text-[12px] sm:text-[16px] drop-shadow-md">🎨</span>
                                        <input 
                                            type="color" 
                                            value={color !== '#000000' ? color : (customColor || '#ffffff')} 
                                            onChange={handleColorPick} 
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                                        />
                                    </div>

                                    {customColor && (
                                        <div 
                                            className={`color-btn shrink-0 w-6 h-6 sm:w-8 sm:h-8 ${color === customColor ? 'active' : ''}`} 
                                            style={{backgroundColor: customColor}} 
                                            onClick={() => setColor(customColor)} 
                                        />
                                    )}
                                </div>
                                <div className="flex gap-1 ml-4 shrink-0">
                                    <button className="ui-btn px-2 py-1 text-sm" onClick={undo}>↩️</button>
                                    <button className="ui-btn px-2 py-1 text-sm" onClick={cancelEdit}>❎</button>
                                    <button className="ui-btn px-2 py-1 text-sm" onClick={okEdit}>🆗</button>
                                    <button className="ui-btn px-2 py-1 text-sm" onClick={flipImage}>↔️</button>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-500 whitespace-nowrap">太さ</span>
                                <input type="range" min="0" max="3" step="1" value={lineWidthIdx} onChange={(e)=>setLineWidthIdx(parseInt(e.target.value))} className="scroll-bar" />
                            </div>
                        </div>
                    </div>

                    <div className="w-20 sm:w-24 bg-white shadow-lg flex flex-col border-l border-gray-200 shrink-0 z-20 h-full">
                        <div className="menu-scroll-area">
                            {['body','hand','foot','equip'].map(type => (
                                <div key={type} className="flex flex-col border-b border-gray-100">
                                    <button 
                                        className={`p-2 sm:p-3 font-bold text-xs sm:text-sm sticky top-0 z-10 ${rightMenuMode === type ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                                        onClick={() => changeMenuMode(type)}>
                                        {type === 'body' ? '身体' : type === 'hand' ? '手' : type === 'foot' ? '足' : '装備'}
                                    </button>
                                    {rightMenuMode === type && (
                                        <div className="flex flex-col bg-gray-50 p-1 gap-1">
                                            {parts.filter(p => p.type === type).map((p, idx) => (
                                                <button key={p.id} className={`ui-btn py-1 text-xs ${selectedPartId === p.id ? 'active' : ''}`} onClick={() => selectPart(p.id)}>
                                                    {type === 'equip' ? (p.subType === 'melee'?'🗡️':p.subType==='shoot'?'🔫':'🛡️') : ''}
                                                    {['①','②','③','④','⑤','⑥','⑦','⑧'][idx] || idx+1}
                                                </button>
                                            ))}
                                            <button className="ui-btn py-1 text-[10px] sm:text-xs text-blue-600 border-blue-200 bg-white" onClick={() => {
                                                if(type === 'equip') setShowSubMenu('equipType');
                                                else addPart(type);
                                            }}>＋追加</button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        
                        <div className="flex-none border-t border-gray-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                            <button className="w-full p-2 sm:p-3 font-bold text-xs sm:text-sm text-green-700 hover:bg-green-50" onClick={handleQRMenu}>[QR]</button>
                            <button className={`w-full p-3 sm:p-4 font-bold text-white bg-blue-500 hover:bg-blue-600 ${isSaveDisabled ? 'opacity-50' : ''}`} onClick={handleFinishDraw}>OK</button>
                        </div>
                    </div>

                    {inkWarning && (
                        <div className="ink-warning">
                            インクが足りないよ…。
                        </div>
                    )}
                </div>

                {showConfirm && (
                    <Modal 
                        text={showConfirm.text} 
                        onOk={() => {
                            if (showConfirm.action === 'delete') {
                                setParts(prev => prev.filter(p => p.id !== selectedPartId));
                                setSelectedPartId(null);
                            } else if (showConfirm.action === 'finish') {
                                if(typeof computePartData !== 'undefined'){
                                    const finalizedParts = parts.map(p => computePartData(p)); 
                                    onComplete(finalizedParts);
                                } else {
                                    setErrorMsg("外部スクリプトの読み込みが完了していません。\nページを再読み込みしてください。");
                                    setShowSubMenu('error');
                                    setShowConfirm(null);
                                }
                            }
                            setShowConfirm(null);
                        }}
                        onCancel={() => setShowConfirm(null)} 
                    />
                )}

                {showSubMenu === 'loading' && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <p className="text-xl font-bold">処理中です...</p>
                        </div>
                    </div>
                )}

                {showSubMenu === 'error' && (
                    <div className="modal-overlay">
                        <div className="modal-content relative">
                            <button className="absolute top-2 right-2 text-xl" onClick={() => setShowSubMenu(null)}>❌</button>
                            <p className="font-bold mb-4 text-red-500">エラー</p>
                            <p className="whitespace-pre-wrap text-sm font-bold">{errorMsg}</p>
                        </div>
                    </div>
                )}

                {showSubMenu === 'equipType' && (
                    <div className="modal-overlay">
                        <div className="modal-content relative">
                            <button className="absolute top-2 right-2 text-xl" onClick={() => setShowSubMenu(null)}>❌</button>
                            <p className="font-bold mb-4">装備タイプを選択</p>
                            <div className="flex flex-col gap-2">
                                <button className="ui-btn py-3" onClick={() => { addPart('equip', 'melee', tempTarget); setShowSubMenu(null); setTempTarget(null); }}>🗡️ 接触</button>
                                <button className="ui-btn py-3" onClick={() => { addPart('equip', 'shoot', tempTarget); setShowSubMenu(null); setTempTarget(null); }}>🔫 射撃</button>
                                <button className="ui-btn py-3" onClick={() => { addPart('equip', 'shield', tempTarget); setShowSubMenu(null); setTempTarget(null); }}>🛡️ 防具</button>
                            </div>
                        </div>
                    )}

                {showSubMenu === 'footType' && (
                    <div className="modal-overlay">
                        <div className="modal-content relative">
                            <button className="absolute top-2 right-2 text-xl" onClick={() => setShowSubMenu(null)}>❌</button>
                            <p className="font-bold mb-4">足の機能を選択</p>
                            <div className="flex flex-col gap-2">
                                <button className="ui-btn py-3" onClick={() => { setParts(prev=>prev.map(p=>p.id===selectedPartId?{...p,subType:'walk'}:p)); setShowSubMenu(null); }}>🚶 歩行</button>
                                <button className="ui-btn py-3" onClick={() => { setParts(prev=>prev.map(p=>p.id===selectedPartId?{...p,subType:'wheel'}:p)); setShowSubMenu(null); }}>⚙️ 車輪</button>
                                <button className="ui-btn py-3" onClick={() => { setParts(prev=>prev.map(p=>p.id===selectedPartId?{...p,subType:'fly'}:p)); setShowSubMenu(null); }}>🪽 飛行</button>
                            </div>
                        </div>
                    )}

                {showSubMenu === 'equipListForHand' && (
                    <div className="modal-overlay">
                        <div className="modal-content relative max-h-[80vh] overflow-y-auto">
                            <button className="absolute top-2 right-2 text-xl" onClick={() => setShowSubMenu(null)}>❌</button>
                            <p className="font-bold mb-4">この手に持たせる装備を選択</p>
                            <div className="flex flex-col gap-2">
                                {parts.filter(p => p.type === 'equip').map((p, idx) => (
                                    <button key={p.id} className="ui-btn py-2" onClick={() => { handleEquipSelectFromHand(p.id); setShowSubMenu(null); }}>
                                        {p.subType === 'melee'?'🗡️':p.subType==='shoot'?'🔫':'🛡️'} 装備 {idx+1}
                                    </button>
                                ))}
                                <button className="ui-btn py-2 text-blue-600" onClick={() => { setTempTarget(selectedPartId); setShowSubMenu('equipType'); }}>＋ 新規作成</button>
                            </div>
                        </div>
                    )}

                {showSubMenu === 'qr' && !generatedImage && (
                    <div className="modal-overlay">
                        <div className="modal-content relative">
                            <button className="absolute top-2 right-2 text-xl" onClick={() => setShowSubMenu(null)}>❌</button>
                            <p className="font-bold mb-4">QRデータ</p>
                            <div className="flex gap-4">
                                <button className={`ui-btn flex-1 flex-col py-6 ${isSaveDisabled ? 'opacity-50 cursor-not-allowed' : ''}`} onClick={handleSaveQR}>
                                    <span className="text-3xl mb-2">⬇️</span>
                                    <span>保存</span>
                                </button>
                                <label className="ui-btn flex-1 flex-col py-6 cursor-pointer">
                                    <span className="text-3xl mb-2">⬆️</span>
                                    <span>読込</span>
                                    <input type="file" accept="image/*" className="hidden" onChange={handleLoadQR} />
                                </label>
                            </div>
                        </div>
                    )}

                {generatedImage && (
                    <div className="modal-overlay">
                        <div className="modal-content relative flex flex-col items-center max-w-3xl w-[95%] p-4">
                            <button className="absolute top-2 right-2 text-2xl text-gray-500 hover:text-black" onClick={() => setGeneratedImage(null)}>❌</button>
                            <p className="font-bold mb-2 text-blue-600 mt-6 text-sm sm:text-base">画像を長押しして「写真に追加」で保存してください</p>
                            <p className="text-xs text-gray-500 mb-4">※PCの場合は右クリックで保存</p>
                            <img src={generatedImage} alt="QR Code" className="max-w-full border-2 border-gray-300 rounded shadow-sm mb-4" />
                        </div>
                    </div>
                )}
            </div>
        );
    };
})();