type StyleValue = any;
const isHex=(value:unknown):value is string=>typeof value==="string"&&/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
const normalizeHex=(hex:string)=>hex.length===4?"#"+hex.slice(1).split("").map(ch=>ch+ch).join(""):hex;
const luminance=(hex:string)=>{const value=normalizeHex(hex);const channel=(part:string)=>{const n=parseInt(part,16)/255;return n<=0.04045?n/12.92:Math.pow((n+0.055)/1.055,2);};return 0.2126*channel(value.slice(1,3))+0.7152*channel(value.slice(3,5))+0.0722*channel(value.slice(5,7));};
export function themeStyles<T>(styles:T,dark:boolean):T{
 if(!dark)return styles;
 const walk=(value:StyleValue,key=""):StyleValue=>{
  if(Array.isArray(value))return value.map(item=>walk(item,key));
  if(value&&typeof value==="object"){const out:any={};for(const [k,v] of Object.entries(value))out[k]=walk(v,k);return out;}
  if(!isHex(value))return value;
  const light=luminance(value);
  const rgb=normalizeHex(value);
  const channels=[parseInt(rgb.slice(1,3),16),parseInt(rgb.slice(3,5),16),parseInt(rgb.slice(5,7),16)];
  const chroma=(Math.max(...channels)-Math.min(...channels))/255;
  if(key==="backgroundColor"){
   if(chroma>0.25&&light>0.25)return value;
   if(light>=0.88)return "#1E1E22";
   if(light>=0.55)return "#29292F";
   if(light>=0.18)return "#303036";
   if(light<=0.025)return "#18181B";
   return value;
  }
  if(key==="borderColor")return light>0.12?"#FFFFFF1F":"#FFFFFF24";
  if(key==="color"){
   if(light<=0.08)return "#F4F4F5";
   if(light<0.32)return "#E4E4E7";
   if(light<0.58)return "#A1A1AA";
   return value;
  }
  if(key==="shadowColor")return "#000000";
  return value;
 };
 return walk(styles) as T;
}
