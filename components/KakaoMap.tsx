import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};
export type KakaoMapMarker = {
  id: string;
  name: string;
  area: string;
  latitude: number;
  longitude: number;
};
export type KakaoMapHandle = {
  animateToRegion: (region: MapRegion, duration?: number) => void;
};
type Props = {
  initialRegion: MapRegion;
  markers: KakaoMapMarker[];
  selectedId?: string | null;
  currentLocation?: { latitude: number; longitude: number } | null;
  onRegionChangeComplete?: (region: MapRegion) => void;
  onMarkerPress?: (id: string) => void;
};

const JS_KEY = "796faa03766bba20c84ad42e14a2d4e8";

function buildHtml(initialRegion: MapRegion) {
  const center = JSON.stringify({ lat: initialRegion.latitude, lng: initialRegion.longitude });
  const level = Math.max(1, Math.min(14, Math.round(7 + Math.log2(initialRegion.latitudeDelta / 0.06))));
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body,#map{width:100%;height:100%;margin:0;padding:0;overflow:hidden;background:#f4f1f8} .load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7661D8;font:14px sans-serif;background:#f4f1f8;z-index:2}</style>
<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false"></script></head>
<body><div id="map"></div><div id="load" class="load">지도를 불러오는 중…</div>
<script>
(function(){
  var map=null, markers={}, currentMarker=null, pending=[], currentSelected=null;
  function post(data){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(data)); }catch(e){} }
  function levelFor(delta){ return Math.max(1,Math.min(14,Math.round(7+Math.log2(Math.max(delta,0.001)/0.06)))); }
  function pinImage(selected){
    var color=selected?'%237661D8':'%23A58BEA';
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path d="M17 1C8.2 1 1 8.2 1 17c0 11 16 24 16 24s16-13 16-24C33 8.2 25.8 1 17 1z" fill="'+color+'" stroke="white" stroke-width="2"/><circle cx="17" cy="17" r="5" fill="white"/></svg>';
    return new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),new kakao.maps.Size(34,42),{offset:new kakao.maps.Point(17,42)});
  }
  function updateMarkers(list, selectedId, location){
    if(!map)return;
    var keep={};
    (list||[]).forEach(function(item){
      keep[item.id]=true;
      var pos=new kakao.maps.LatLng(item.latitude,item.longitude);
      if(!markers[item.id]){
        var marker=new kakao.maps.Marker({position:pos,image:pinImage(item.id===selectedId),title:item.name});
        marker.setMap(map);
        kakao.maps.event.addListener(marker,'click',function(){post({type:'marker',id:item.id});});
        markers[item.id]=marker;
      }else{
        markers[item.id].setPosition(pos);
        markers[item.id].setImage(pinImage(item.id===selectedId));
        markers[item.id].setTitle(item.name);
      }
    });
    Object.keys(markers).forEach(function(id){if(!keep[id]){markers[id].setMap(null);delete markers[id];}});
    if(location && location.latitude!=null && location.longitude!=null){
      var here=new kakao.maps.LatLng(location.latitude,location.longitude);
      if(!currentMarker){currentMarker=new kakao.maps.Marker({position:here,image:new kakao.maps.MarkerImage('https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',new kakao.maps.Size(24,35))});currentMarker.setMap(map);}
      else currentMarker.setPosition(here);
    }else if(currentMarker){currentMarker.setMap(null);currentMarker=null;}
  }
  function moveTo(region,duration){
    if(!map||!region)return;
    var center=new kakao.maps.LatLng(region.latitude,region.longitude);
    map.setLevel(levelFor(region.latitudeDelta),{anchor:center,animate:{duration:duration||400}});
    map.panTo(center);
  }
  function emitRegion(){
    if(!map)return;
    var center=map.getCenter(), bounds=map.getBounds(), sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    post({type:'region',region:{latitude:center.getLat(),longitude:center.getLng(),latitudeDelta:Math.max(0.002,ne.getLat()-sw.getLat()),longitudeDelta:Math.max(0.002,ne.getLng()-sw.getLng())}});
  }
  function apply(message){
    if(!map){pending.push(message);return;}
    if(message.type==='markers')updateMarkers(message.markers,message.selectedId,message.currentLocation);
    if(message.type==='animate')moveTo(message.region,message.duration);
  }
  window.addEventListener('message',function(event){try{apply(JSON.parse(event.data));}catch(e){}});
  document.addEventListener('message',function(event){try{apply(JSON.parse(event.data));}catch(e){}});
  if(!window.kakao || !kakao.maps){document.getElementById('load').textContent='카카오 지도 SDK를 불러오지 못했습니다. 키와 웹 도메인 설정을 확인해주세요.';post({type:'error',message:'Kakao Maps SDK load failed'});return;}
  kakao.maps.load(function(){
    map=new kakao.maps.Map(document.getElementById('map'),{center:new kakao.maps.LatLng(${center}.lat,${center}.lng),level:${level}});
    kakao.maps.event.addListener(map,'dragend',emitRegion);
    kakao.maps.event.addListener(map,'zoom_changed',emitRegion);
    document.getElementById('load').style.display='none';
    post({type:'ready'});
    pending.forEach(apply);pending=[];
  });
})();
</script></body></html>`;
}

const KakaoMap = forwardRef<KakaoMapHandle, Props>(function KakaoMap(
  { initialRegion, markers, selectedId, currentLocation, onRegionChangeComplete, onMarkerPress },
  ref
) {
  const webRef = useRef<WebView>(null);
  const html = useRef(buildHtml(initialRegion)).current;
  useImperativeHandle(ref, () => ({
    animateToRegion: (region, duration = 400) => {
      webRef.current?.postMessage(JSON.stringify({ type: "animate", region, duration }));
    },
  }), []);
  useEffect(() => {
    webRef.current?.postMessage(JSON.stringify({
      type: "markers",
      markers,
      selectedId: selectedId ?? null,
      currentLocation: currentLocation ?? null,
    }));
  }, [markers, selectedId, currentLocation]);
  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === "region" && message.region) onRegionChangeComplete?.(message.region);
      if (message.type === "marker" && typeof message.id === "string") onMarkerPress?.(message.id);
    } catch {
      // Ignore malformed messages from the map page.
    }
  };
  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ html, baseUrl: "https://localhost" }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        onMessage={handleMessage}
        onLoadEnd={() => webRef.current?.postMessage(JSON.stringify({
          type: "markers", markers, selectedId: selectedId ?? null, currentLocation: currentLocation ?? null,
        }))}
        style={styles.webview}
      />
    </View>
  );
});
export default KakaoMap;
const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
  webview: { flex: 1, backgroundColor: "transparent" },
});
