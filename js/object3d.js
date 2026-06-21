/* ============================================================
   OBJECT3D.JS — 3D-меши из изображений
   Режим A: DoubleSide пластина (текстура с обеих сторон)
   Режим B: ShapeGeometry точно по alpha-контуру PNG
   ============================================================ */
window.Object3D = (function () {
  const { state } = App;

  /* ── загрузить текстуру ── */
  function _loadTex(url) {
    return new Promise(res => {
      const loader = new THREE.TextureLoader();
      loader.load(url, tex => {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 4;
        res(tex);
      });
    });
  }

  /* ── прочитать пиксели изображения ── */
  function _readPixels(img, maxSide = 512) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(4, Math.round(img.width * scale));
    const h = Math.max(4, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return { data: c.getContext('2d').getImageData(0, 0, w, h).data, w, h };
  }

  /* ── построить THREE.Shape по alpha-контуру ── */
  function _buildShape(img, objW, objH) {
    try {
      const { data, w, h } = _readPixels(img, 512);
      const ALPHA = 20; // порог прозрачности

      // бинарная карта непрозрачности
      const solid = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] > ALPHA ? 1 : 0;

      // найти первую непрозрачную точку
      let sx = -1, sy = -1;
      outer: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (solid[y * w + x]) { sx = x; sy = y; break outer; }
      }
      if (sx < 0) return null;

      // обход контура (Moore neighbourhood)
      const pts = _traceContour(solid, w, h, sx, sy);
      if (!pts || pts.length < 6) return null;

      // упрощение Ramer–Douglas–Peucker
      const eps = Math.max(w, h) * 0.012;
      const simp = _rdp(pts, eps);
      if (simp.length < 3) return null;

      // пиксели → Three.js координаты
      const shape = new THREE.Shape();
      const p0 = _px2world(simp[0], w, h, objW, objH);
      shape.moveTo(p0.x, p0.y);
      for (let i = 1; i < simp.length; i++) {
        const p = _px2world(simp[i], w, h, objW, objH);
        shape.lineTo(p.x, p.y);
      }
      shape.closePath();
      return shape;
    } catch (e) {
      console.warn('buildShape failed:', e);
      return null;
    }
  }

  /* ── трассировка контура ── */
  function _traceContour(solid, w, h, sx, sy) {
    const dx8 = [1,1,0,-1,-1,-1,0,1];
    const dy8 = [0,1,1,1,0,-1,-1,-1];
    const pts = [];
    let x=sx, y=sy, dir=0;
    const key = (x,y) => y*w+x;
    const visited = new Set();
    const MAX = w*h;

    for (let step=0; step<MAX; step++) {
      const k = key(x,y);
      if (visited.has(k) && x===sx && y===sy && pts.length>4) break;
      visited.add(k);
      pts.push({x,y});

      // правило правой руки: начинаем с направления "назад"+45°
      const startDir = (dir+6)%8;
      let found = false;
      for (let i=0;i<8;i++) {
        const d=(startDir+i)%8;
        const nx=x+dx8[d], ny=y+dy8[d];
        if (nx>=0&&nx<w&&ny>=0&&ny<h&&solid[ny*w+nx]) {
          x=nx; y=ny; dir=d; found=true; break;
        }
      }
      if (!found) break;
    }
    return pts;
  }

  /* ── Ramer–Douglas–Peucker ── */
  function _rdp(pts, eps) {
    if (pts.length<=2) return pts;
    const a=pts[0], b=pts[pts.length-1];
    let maxD=0, idx=0;
    for (let i=1;i<pts.length-1;i++) {
      const d=_ptLineDist(pts[i],a,b);
      if(d>maxD){maxD=d;idx=i;}
    }
    if (maxD>eps) {
      const L=_rdp(pts.slice(0,idx+1),eps);
      const R=_rdp(pts.slice(idx),eps);
      return [...L.slice(0,-1),...R];
    }
    return [a,b];
  }

  function _ptLineDist(p,a,b) {
    const dx=b.x-a.x, dy=b.y-a.y;
    if(!dx&&!dy) return Math.hypot(p.x-a.x,p.y-a.y);
    const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);
    return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
  }

  /* ── пиксель → Three.js ── */
  function _px2world({x,y},w,h,objW,objH) {
    return { x:(x/w-0.5)*objW, y:-(y/h-0.5)*objH };
  }

  /* ── UV для ShapeGeometry ── */
  function _setShapeUV(geo, objW, objH) {
    const pos=geo.attributes.position;
    const uvs=new Float32Array(pos.count*2);
    for(let i=0;i<pos.count;i++){
      uvs[i*2]   = pos.getX(i)/objW+0.5;
      uvs[i*2+1] = pos.getY(i)/objH+0.5;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs,2));
  }

  /* ── боковины по контуру Shape ── */
  function _buildSides(group, shape, depth, edgeColor) {
    if (depth < 0.001) return;
    const mat = new THREE.MeshLambertMaterial({ color: edgeColor, side: THREE.DoubleSide });
    const pts  = shape.getPoints(0);
    for (let i=0;i<pts.length;i++) {
      const a=pts[i], b=pts[(i+1)%pts.length];
      const len=Math.hypot(b.x-a.x,b.y-a.y);
      if (len<0.001) continue;
      const geo=new THREE.PlaneGeometry(len,depth);
      const seg=new THREE.Mesh(geo,mat);
      seg.position.set((a.x+b.x)/2,(a.y+b.y)/2,0);
      seg.rotation.z=Math.atan2(b.y-a.y,b.x-a.x);
      seg.rotation.x=Math.PI/2;
      group.add(seg);
    }
  }

  /* ── средний цвет краёв ── */
  function _edgeColor(tex) {
    try {
      const img=tex.image;
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
      const s=(x,y)=>{const d=ctx.getImageData(x,y,1,1).data;return[d[0],d[1],d[2]];};
      const pw=img.width-1,ph=img.height-1,mx=Math.floor(img.width/2),my=Math.floor(img.height/2);
      const pts=[s(0,0),s(pw,0),s(0,ph),s(pw,ph),s(mx,0),s(0,my),s(pw,my),s(mx,ph)];
      const avg=pts.reduce((a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],[0,0,0]);
      return new THREE.Color(avg[0]/pts.length/255,avg[1]/pts.length/255,avg[2]/pts.length/255);
    } catch { return new THREE.Color(0x888888); }
  }

  /* ══════════════════════════════════════
     ОСНОВНАЯ ФУНКЦИЯ: buildMesh
  ══════════════════════════════════════ */
  async function buildMesh(obj) {
    if (obj._mesh && state.scene) { state.scene.remove(obj._mesh); obj._mesh=null; }

    const url = (obj.useBgRemove && obj.processedURL) ? obj.processedURL : obj.imageURL;
    if (!url) return null;

    const tex   = await _loadTex(url);
    obj._texture = tex;

    const imgW  = tex.image.width;
    const imgH  = tex.image.height;
    const asp   = imgW / imgH;

    const objH  = 1;
    const objW  = asp;
    const depth = (obj.thickness / Math.max(imgW,imgH)) * objH * 5;

    const group = new THREE.Group();
    const ec    = _edgeColor(tex);

    if (obj.mode === 'A') {
      /* ─── Режим A: пластина DoubleSide ─── */
      const geo = new THREE.BoxGeometry(objW, objH, depth);

      const matFace = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, alphaTest: 0.05,
        side: THREE.DoubleSide,   // ← ОБЕ стороны
      });
      const matSide = new THREE.MeshLambertMaterial({
        color: ec, transparent: true,
      });
      // BoxGeometry: right,left,top,bottom,front,back
      const mats = [matSide,matSide,matSide,matSide,matFace,matFace];
      group.add(new THREE.Mesh(geo, mats));

    } else {
      /* ─── Режим B: ShapeGeometry по alpha-контуру ─── */
      const shape = _buildShape(tex.image, objW, objH);

      const matDS = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, alphaTest: 0.05,
        side: THREE.DoubleSide,
      });

      if (shape) {
        // лицевая
        const geoF = new THREE.ShapeGeometry(shape);
        _setShapeUV(geoF, objW, objH);
        const front = new THREE.Mesh(geoF, matDS);
        front.position.z = depth/2;
        group.add(front);

        // задняя (клон)
        const geoB = geoF.clone();
        const back  = new THREE.Mesh(geoB, matDS);
        back.position.z = -depth/2;
        group.add(back);

        // боковины
        _buildSides(group, shape, depth, ec);
      } else {
        // фолбэк если контур не найден
        const geoF = new THREE.PlaneGeometry(objW, objH);
        const front = new THREE.Mesh(geoF, matDS);
        front.position.z = depth/2;
        group.add(front);
        const geoB = new THREE.PlaneGeometry(objW, objH);
        const back  = new THREE.Mesh(geoB, matDS);
        back.position.z = -depth/2;
        group.add(back);
      }
    }

    _applyTransform(group, obj);
    if (state.scene) state.scene.add(group);
    obj._mesh = group;
    return group;
  }

  /* ── трансформации ── */
  function _applyTransform(mesh, obj) {
    const vw = App.state.videoWidth  || 1280;
    const vh = App.state.videoHeight || 720;
    mesh.position.x = (obj.x/vw-0.5)*2*(vw/vh);
    mesh.position.y = -(obj.y/vh-0.5)*2;
    mesh.position.z = 0;
    mesh.scale.setScalar(obj.scale);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(obj.rotX),
      THREE.MathUtils.degToRad(obj.rotY),
      THREE.MathUtils.degToRad(obj.rotZ),
    );
  }

  function updateTransform(obj) {
    if (obj._mesh) _applyTransform(obj._mesh, obj);
  }

  function updateOpacity(obj, opacity) {
    if (!obj._mesh) return;
    obj._mesh.traverse(c => {
      if (!c.isMesh) return;
      const ms = Array.isArray(c.material)?c.material:[c.material];
      ms.forEach(m => m.opacity=opacity);
    });
  }

  function updateVisibility(obj) {
    if (obj._mesh) obj._mesh.visible = obj.visible;
  }

  function animateTick(obj, dt) {
    if (!obj._mesh) return;
    const t = App.state.currentTime;
    let op = obj.opacity;
    if (t<obj.startTime||t>obj.endTime){obj._mesh.visible=false;return;}
    obj._mesh.visible=obj.visible;
    if(obj.fadeInEnd>obj.fadeInStart&&t>=obj.fadeInStart&&t<=obj.fadeInEnd)
      op*=Math.min(1,(t-obj.fadeInStart)/(obj.fadeInEnd-obj.fadeInStart));
    else if(t<obj.fadeInEnd) op=0;
    if(obj.fadeOutEnd>obj.fadeOutStart&&t>=obj.fadeOutStart&&t<=obj.fadeOutEnd)
      op*=Math.max(0,1-(t-obj.fadeOutStart)/(obj.fadeOutEnd-obj.fadeOutStart));
    else if(t>obj.fadeOutStart&&obj.fadeOutEnd>obj.fadeOutStart) op=0;
    updateOpacity(obj,Math.max(0,Math.min(1,op)));
    if(obj.autoRotX) obj._mesh.rotation.x+=THREE.MathUtils.degToRad(obj.rotSpeedX*obj.rotDirX*dt);
    if(obj.autoRotY) obj._mesh.rotation.y+=THREE.MathUtils.degToRad(obj.rotSpeedY*obj.rotDirY*dt);
    if(obj.autoRotZ) obj._mesh.rotation.z+=THREE.MathUtils.degToRad(obj.rotSpeedZ*obj.rotDirZ*dt);
  }

  async function rebuild(obj) { await buildMesh(obj); }

  return { buildMesh, updateTransform, updateOpacity, updateVisibility, animateTick, rebuild };
})();
