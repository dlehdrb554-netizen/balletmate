type StyleValue = any;
const isHex=(value:unknown):value is string=>typeof value==="string"&&/^#[0-9a-f]{6}$/i.test(value);
const luminance=(hex:string)=>{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return (0.2126*r+0.7152*g+0.0722*b)/255;};
export function themeStyles<T>(styles:T,dark:boolean):T{
 if(!dark)return styles;
 const walk=(value:StyleValue,key=""):StyleValue=>{
  if(Array.isArray(value))return value.map(item=>walk(item,key));
  if(value&&typeof value==="object"){const out:any={};for(const [k,v] of Object.entries(value))out[k]=walk(v,k);return out;}
  if(!isHex(value))return value;
  const light=luminance(value);
  if(key==="backgroundColor"){
   if(light>0.88)return "#24212D";
   if(light>0.68)return "#302C3A";
   if(light>0.48)return "#40394D";
   return value;
  }
  if(key==="borderColor")return light>0.35?"#3B3748":value;
  if(key==="color"){
   if(light<0.28)return "#F4F1FA";
   if(light<0.52)return "#C2BDCC";
   return value;
  }
  if(key==="shadowColor")return "#000000";
  return value;
 };
 return walk(styles) as T;
}
