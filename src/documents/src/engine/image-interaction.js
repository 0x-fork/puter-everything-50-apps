import { EMU_PER_PX, inlineImagePaintFrame, normalizedRotation, ANGLE_PER_DEGREE, rotationOutsets, imageExtents, CROP_SIDES } from './images.js';
import { positionedImageBounds, positionedImageFrame } from './positioned-images.js';
import { resizeImageFrame } from './image-resize.js';
import { boundaries } from './model.js';

/** Gestures preview a frame; one validated transaction is committed on release. */
export function createImageInteraction(editor) {
  const overlay = document.createElement('div'); overlay.className = 'canvas-image-frame'; overlay.hidden = true;
  editor.host.append(overlay);
  const listen = (node, type, fn) => node.addEventListener(type, fn, {signal:editor.abort.signal});
  let gesture;
  // Drawings resize only through an editor that can rewrite them (simple preset shapes); pictures resize directly.
  const scenePicture = image => !!editor.pictureEditor?.canResize(image);
  const resizableDrawing = image => scenePicture(image) || !!editor.drawingEditor?.canResize(image);
  const resizeImage = (image, patch) => scenePicture(image) ? editor.pictureEditor.resize(patch) : image.retainedDrawing ? editor.drawingEditor.resize(patch) : editor.setImageProperties(patch);
  const frame = () => {
    const image=editor.model.selectedImage, [start,end]=editor.model.range;
    if (!image || editor.readOnly || editor.accessible) return null;
    const layout=editor.selectionLayout;
    const floating=(layout.floatingObjects || []).find(f=>f.start===start && f.end===end);
    if (floating) return {...floating, floating:true};
    for(const line of [...layout.lines,...(layout.repeatedLines || [])]) {
      const f=line.fragments.find(f=>f.image && f.start===start && f.end===end);
      if(f) return {...inlineImagePaintFrame(f.image,f.uprightImage?.x ?? f.x,f.uprightImage?.y ?? line.baseline-f.ascent),image:f.image,page:line.page,start,end};
    }
    return null;
  };
  const show = box => {
    const canvas=editor.canvases[box.page]; if(!canvas) return;
    Object.assign(overlay.style,{left:`${canvas.offsetLeft+box.x*editor.zoom}px`,top:`${canvas.offsetTop+box.y*editor.zoom}px`,width:`${box.width*editor.zoom}px`,height:`${box.height*editor.zoom}px`,transform:`rotate(${normalizedRotation(box.image?.rotation)/ANGLE_PER_DEGREE}deg)`});
  };
  const placement = f => {
    const anchor=f.image.anchor;
    const layout=editor.selectionLayout, lines=[...layout.lines,...(layout.repeatedLines || [])];
    const line=lines.find(l=>l.fragments.some(p=>p.image && p.start===f.start && p.end===f.end));
    const first=anchor.vertical==='line'?line:lines.find(l=>l.paragraphId===line?.paragraphId && l.page===f.page);
    const geometry=editor.layout.pageRegions[f.page]?.[f.region]?.geometry || editor.layout.pages[f.page];
    const cell=line?.cellId ? layout.cells.find(c=>c.id===line.cellId && c.page===f.page) : null;
    return positionedImageFrame(f,first,{...geometry,drawingBounds:editor.layout.pageRegions[f.page]?.[f.region]?.drawingBounds},cell);
  };
  const offsets = f => {
    const anchor={...f.image.anchor,x:0,y:0};
    for(const axis of ['x','y']) {delete anchor[axis+'Align'];delete anchor[axis+'Percentage'];}
    const zero=placement({...f,image:{...f.image,anchor}});
    return {x:Math.round((f.x-zero.x)*EMU_PER_PX),y:Math.round((f.y-zero.y)*EMU_PER_PX)};
  };
  const resizePatch = (f, resized) => {
    const {width,height,frame:desired}=resized,patch={width,height};
    if(!f.floating)return patch;
    const next={...f.image,width,height},oldRequired=rotationOutsets(f.image),nextRequired=rotationOutsets(next),oldExtent=imageExtents(f.image);
    // Use the same geometric outsets as the model's validated size transaction.
    next.effectExtent=Object.fromEntries(CROP_SIDES.map(side=>[side,nextRequired[side]+Math.max(0,oldExtent[side]-oldRequired[side])]));
    const projected=placement({...f,image:next}),numeric=offsets({...desired,image:next});
    for(const axis of ['x','y']) if(Math.abs(projected[axis]-desired[axis])>1e-7) (patch.anchor ||= {})[axis]=numeric[axis];
    return patch;
  };
  const begin = (e, mode='move') => {
    const f=frame(); if(!f || e.button!==0) return false;
    if(mode!=='move' && (f.image.retainedDrawing && !resizableDrawing(f.image) || f.image.anchor?.relativeSize)) return false;
    gesture={mode,frame:f,box:f.image.retainedDrawing?positionedImageBounds(f):f,start:{x:e.clientX,y:e.clientY},range:[...editor.model.range],model:editor.model,revision:editor.session.revision,dx:0,dy:0,scale:1};
    if(f.floating) gesture.offsets=offsets(f);
    overlay.hidden=false; show({...gesture.box,page:f.page});
    e.preventDefault(); editor.pages.setPointerCapture(e.pointerId); editor.focus(); return true;
  };
  function update() {
    if(gesture) return;
    const f=frame(); overlay.hidden=!f; if(!f) return;
    show({... (f.image.retainedDrawing?positionedImageBounds(f):f),page:f.page});
    for(const button of overlay.querySelectorAll('[data-handle]')) {
      button.hidden=!!f.image.retainedDrawing && !resizableDrawing(f.image) || !!f.image.anchor?.relativeSize;
      const angle=(f.image.retainedDrawing?0:normalizedRotation(f.image.rotation)/ANGLE_PER_DEGREE)+(['nw','se'].includes(button.dataset.handle)?45:135);
      button.style.cursor=['ew-resize','nwse-resize','ns-resize','nesw-resize'][Math.round(angle/45)%4];
    }
  }
  const move = e => {
    if(!gesture) return false;
    const g=gesture; g.dx=(e.clientX-g.start.x)/editor.zoom;g.dy=(e.clientY-g.start.y)/editor.zoom;
    if(g.mode==='move') {
      if(!g.frame.floating) g.target=editor.point(e,false);
      show({...g.box,page:g.frame.page,x:g.box.x+g.dx,y:g.box.y+g.dy});
    } else if (!g.frame.image.retainedDrawing || scenePicture(g.frame.image)) {
      g.resized=resizeImageFrame(g.frame,g.mode,g.dx,g.dy,{preserveAspect:g.frame.image.aspectLocked!==false || e.shiftKey,fromCenter:e.ctrlKey || e.altKey});
      show(g.resized.frame);
    } else {
      const sx=g.mode.includes('w')?-1:1,sy=g.mode.includes('n')?-1:1;
      g.scale=Math.max(.01,1+(g.dx*sx*g.box.width+g.dy*sy*g.box.height)/(g.box.width*g.box.width+g.box.height*g.box.height));
      const width=g.box.width*g.scale,height=g.box.height*g.scale;
      show({...g.box,page:g.frame.page,width,height,x:g.box.x+(sx<0?g.box.width-width:0),y:g.box.y+(sy<0?g.box.height-height:0)});
    }
    return true;
  };
  const cancel = () => {if(!gesture)return false;gesture=null;update();return true;};
  const end = e => {
    if(!gesture) return false;move(e);const g=gesture;gesture=null;
    if(g.model!==editor.model || g.revision!==editor.session.revision || Math.hypot(g.dx,g.dy)<3/editor.zoom) {update();return true;}
    editor.model.select(...g.range);
    if(g.mode==='move') {
      if(g.frame.floating) editor.setImageProperties({anchor:{x:g.offsets.x+Math.round(g.dx*EMU_PER_PX),y:g.offsets.y+Math.round(g.dy*EMU_PER_PX)}});
      else editor.execute(()=>editor.model.moveImage(g.target));
    } else if (g.resized) {
      resizeImage(editor.model.selectedImage,resizePatch(g.frame,g.resized));
    } else {
      const image=editor.model.selectedImage, width=Math.max(1,Math.round(image.width*g.scale)),height=Math.max(1,Math.round(width*image.height/image.width));
      const patch={width,height};
      if(g.frame.floating && (g.mode.includes('w') || g.mode.includes('n'))) patch.anchor={x:g.offsets.x+Math.round((g.mode.includes('w')?g.frame.width*(1-g.scale):0)*EMU_PER_PX),y:g.offsets.y+Math.round((g.mode.includes('n')?g.frame.height*(1-g.scale):0)*EMU_PER_PX)};
      resizeImage(image,patch);
    }
    update();return true;
  };
  const button=(label,handle) => {
    const b=document.createElement('button');b.type='button';b.className='canvas-image-handle';b.setAttribute('aria-label',label);
    if(handle) b.dataset.handle=handle; else {b.className='canvas-image-move';b.textContent='Move';}
    listen(b,'pointerdown',e=>{e.stopPropagation();begin(e,handle || 'move');});
    listen(b,'keydown',e=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
      e.preventDefault();e.stopPropagation();const f=frame();if(!f)return;
      const step=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
      if(handle) {
        if(f.image.anchor?.relativeSize || f.image.retainedDrawing && !resizableDrawing(f.image))return;
        if(f.image.aspectLocked===false && (!f.image.retainedDrawing || scenePicture(f.image))) {
          resizeImage(f.image,resizePatch(f,resizeImageFrame(f,handle,dx,dy)));
        } else {const scale=Math.max(.01,1+(dx||dy)/Math.max(f.width,f.height)),width=Math.max(1,Math.round(f.image.width*scale));resizeImage(f.image,{width,height:Math.max(1,Math.round(width*f.image.height/f.image.width))});}
      }
      else if(f.floating) {const at=offsets(f);editor.setImageProperties({anchor:{x:at.x+dx*EMU_PER_PX,y:at.y+dy*EMU_PER_PX}});}
      else {
        const [start,end]=editor.model.range, stops=boundaries(editor.model.text);
        const target=dx<0||dy<0 ? stops.findLast(p=>p<start) : stops.find(p=>p>end);
        if(target!==undefined) editor.execute(()=>editor.model.moveImage(target));
      }
    });
    overlay.append(b);
  };
  button('Move selected image');for(const corner of ['nw','ne','sw','se']) button(`Resize image ${corner}`,corner);
  listen(window,'keydown',e=>{if(e.key==='Escape' && cancel()){e.preventDefault();e.stopPropagation();}});
  return {update,begin,move,end,cancel,get active(){return !!gesture;}};
}
