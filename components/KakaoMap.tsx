import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import Constants from "expo-constants";

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
  searchedIds?: string[];
  compareIds?: string[];
  currentLocation?: { latitude: number; longitude: number } | null;
  onRegionChangeComplete?: (region: MapRegion) => void;
  onMarkerPress?: (id: string) => void;
  darkMode?: boolean;
};

const JS_KEY = String(Constants.expoConfig?.extra?.kakaoJavascriptKey ?? "");

function buildHtml(initialRegion: MapRegion, darkMode: boolean) {
  const initialSurface = darkMode ? "#1C1C1E" : "#F2F2F7";
  const center = JSON.stringify({ lat: initialRegion.latitude, lng: initialRegion.longitude });
  const level = Math.max(1, Math.min(14, Math.round(7 + Math.log2(initialRegion.latitudeDelta / 0.06))));
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="color-scheme" content="${darkMode ? "dark" : "light"}">
<style>*{box-sizing:border-box}html,body,#map{width:100%;height:100%;margin:0;padding:0;overflow:hidden;background-color:${initialSurface}} .load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7661D8;font:14px sans-serif;background:${initialSurface};z-index:2}</style>
</head>
<body><div id="map"></div><div id="load" class="load">지도를 불러오는 중…</div>
<script>
(function(){
  var map=null, markers={}, markerMeta={}, markerListeners={}, clusterer=null, currentMarker=null, currentLocationMeta=null, pending=[], currentSelected=null, currentSearched=[], currentCompared=[], darkModeEnabled=${JSON.stringify(darkMode)}, regionTimer=null;
  var cachedPinImages={};
  function post(data){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(data)); }catch(e){} }
  function levelFor(delta){ return Math.max(1,Math.min(14,Math.round(7+Math.log2(Math.max(delta,0.001)/0.06)))); }
  function markerState(id, selectedId, searchedIds, compareIds){
    if(id===selectedId)return 'selected';
    if((searchedIds||[]).indexOf(id)>=0)return 'searched';
    if((compareIds||[]).indexOf(id)>=0)return 'compared';
    return 'default';
  }
  function pinImage(state){
    state=state||'default';
    if(cachedPinImages[state])return cachedPinImages[state];
    var colors={selected:'#FF5A1F',searched:'#168CCB',compared:'#15966A',default:'#A58BEA'};
    var color=colors[state]||colors.default;
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path d="M17 1C8.2 1 1 8.2 1 17c0 11 16 24 16 24s16-13 16-24C33 8.2 25.8 1 17 1z" fill="'+color+'" stroke="white" stroke-width="2"/><circle cx="17" cy="17" r="5" fill="white"/></svg>';
    cachedPinImages[state]=new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),new kakao.maps.Size(34,42),{offset:new kakao.maps.Point(17,42)});
    return cachedPinImages[state];
  }
  function refreshMarkerImages(){
    Object.keys(markers).forEach(function(id){
      var state=markerState(id,currentSelected,currentSearched,currentCompared);
      var meta=markerMeta[id]||{};
      if(meta.state!==state){
        markers[id].setImage(pinImage(state));
        meta.state=state;
        markerMeta[id]=meta;
      }
    });
  }
  function updateSelectedMarker(id){
    currentSelected=id||null;
    refreshMarkerImages();
  }
  function updateMarkers(list, selectedId, searchedIds, compareIds, location){
    if(!map)return;
    currentSelected=selectedId||null;
    currentSearched=searchedIds||[];
    currentCompared=compareIds||[];
    var keep={};
    (list||[]).forEach(function(item){
      keep[item.id]=true;
      var pos=new kakao.maps.LatLng(item.latitude,item.longitude);
      if(!markers[item.id]){
        var marker=new kakao.maps.Marker({position:pos,image:pinImage(markerState(item.id,selectedId,currentSearched,currentCompared)),title:item.name});
        if(clusterer)clusterer.addMarker(marker,true);else marker.setMap(map);
        markerListeners[item.id]=function(){updateSelectedMarker(item.id);post({type:'marker',id:item.id});};
        kakao.maps.event.addListener(marker,'click',markerListeners[item.id]);
        markers[item.id]=marker;
        markerMeta[item.id]={latitude:item.latitude,longitude:item.longitude,name:item.name,state:markerState(item.id,selectedId,currentSearched,currentCompared)};
      }else{
        var marker=markers[item.id], meta=markerMeta[item.id]||{};
        if(meta.latitude!==item.latitude||meta.longitude!==item.longitude)marker.setPosition(pos);
        var state=markerState(item.id,selectedId,currentSearched,currentCompared);
        if(meta.state!==state)marker.setImage(pinImage(state));
        if(meta.name!==item.name)marker.setTitle(item.name);
        markerMeta[item.id]={latitude:item.latitude,longitude:item.longitude,name:item.name,state:state};
      }
    });
    Object.keys(markers).forEach(function(id){if(!keep[id]){if(clusterer)clusterer.removeMarker(markers[id],true);kakao.maps.event.removeListener(markers[id],'click',markerListeners[id]);markers[id].setMap(null);delete markers[id];delete markerMeta[id];delete markerListeners[id];}});
    if(clusterer)clusterer.repaint();
    if(location && location.latitude!=null && location.longitude!=null){
      var here=new kakao.maps.LatLng(location.latitude,location.longitude);
      if(!currentMarker){var locationSvg='<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="#ffffff" stroke="#3478F6" stroke-width="3"/><circle cx="18" cy="18" r="7" fill="#3478F6"/><circle cx="18" cy="18" r="3" fill="#ffffff"/></svg>';currentMarker=new kakao.maps.Marker({position:here,image:new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(locationSvg),new kakao.maps.Size(36,36),{offset:new kakao.maps.Point(18,18)}),zIndex:1000});currentMarker.setMap(map);}
      else if(!currentLocationMeta||currentLocationMeta.latitude!==location.latitude||currentLocationMeta.longitude!==location.longitude)currentMarker.setPosition(here);
      currentLocationMeta={latitude:location.latitude,longitude:location.longitude};
    }else if(currentMarker){currentMarker.setMap(null);currentMarker=null;currentLocationMeta=null;}
  }
  function moveTo(region,duration){
    if(!map||!region)return;
    var center=new kakao.maps.LatLng(region.latitude,region.longitude);
    var targetLevel=levelFor(region.latitudeDelta);
    var currentLevel=map.getLevel();
    if(currentLevel!==targetLevel){
      map.setLevel(targetLevel,{animate:false});
      map.setCenter(center);
    }else{
      map.panTo(center);
    }
    window.setTimeout(emitRegion,Math.max(80,Math.min(250,duration||120)));
  }
  function emitRegion(){
    if(!map)return;
    if(regionTimer)clearTimeout(regionTimer);
    regionTimer=setTimeout(function(){emitRegionNow();},350);
  }
  function emitRegionNow(){
    if(!map)return;
    var center=map.getCenter(), bounds=map.getBounds(), sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    post({type:'region',region:{latitude:center.getLat(),longitude:center.getLng(),latitudeDelta:Math.max(0.002,ne.getLat()-sw.getLat()),longitudeDelta:Math.max(0.002,ne.getLng()-sw.getLng())}});
  }
  var darkTilesetRegistered=false;
  var darkOverlayActive=false;
  function registerDarkTileset(){
    if(darkTilesetRegistered)return;
    kakao.maps.Tileset.add('BALLET_DARK_DIM',new kakao.maps.Tileset({
      width:256,
      height:256,
      getTile:function(){
        var tile=document.createElement('div');
        tile.style.width='256px';
        tile.style.height='256px';
        tile.style.background='rgba(12,14,20,0.34)';
        tile.style.pointerEvents='none';
        return tile;
      }
    }));
    darkTilesetRegistered=true;
  }
  function setDarkMode(enabled){
    darkModeEnabled=!!enabled;
    var load=document.getElementById('load');
    var surface=darkModeEnabled?'#1C1C1E':'#F2F2F7';
    document.documentElement.style.background=surface;
    document.body.style.background=surface;
    document.getElementById('map').style.background=surface;
    if(load)load.style.background=surface;
    if(!map)return;
    registerDarkTileset();
    if(darkModeEnabled&&!darkOverlayActive){
      map.addOverlayMapTypeId(kakao.maps.MapTypeId.BALLET_DARK_DIM);
      darkOverlayActive=true;
    }else if(!darkModeEnabled&&darkOverlayActive){
      map.removeOverlayMapTypeId(kakao.maps.MapTypeId.BALLET_DARK_DIM);
      darkOverlayActive=false;
    }
  }
  function apply(message){
    if(!map){pending.push(message);return;}
    if(message.type==='markers')updateMarkers(message.markers,message.selectedId,message.searchedIds,message.compareIds,message.currentLocation);
    if(message.type==='animate')moveTo(message.region,message.duration);
    if(message.type==='theme')setDarkMode(!!message.darkMode);
  }
  window.addEventListener('pagehide',function(){if(regionTimer)clearTimeout(regionTimer);if(clusterer)clusterer.clear();Object.keys(markers).forEach(function(id){kakao.maps.event.removeListener(markers[id],'click',markerListeners[id]);markers[id].setMap(null);});if(currentMarker)currentMarker.setMap(null);});
  window.addEventListener('message',function(event){try{apply(JSON.parse(event.data));}catch(e){}});
  document.addEventListener('message',function(event){try{apply(JSON.parse(event.data));}catch(e){}});
  function fail(reason){
    var el=document.getElementById('load');
    el.textContent='카카오 지도 SDK 로딩 실패\\n'+reason;
    el.style.whiteSpace='pre-line';
    post({type:'error',message:reason});
  }
  window.onerror=function(message,source,line){
    fail('스크립트 오류: '+String(message)+' (line '+line+')');
    return true;
  };
  function initMap(){
    try{
      var mapEl=document.getElementById('map');
      map=new kakao.maps.Map(mapEl,{center:new kakao.maps.LatLng(${center}.lat,${center}.lng),level:${level},tileAnimation:false});
      if(kakao.maps.MarkerClusterer){clusterer=new kakao.maps.MarkerClusterer({map:map,averageCenter:true,minLevel:6,styles:[{width:'42px',height:'42px',background:'rgba(101,59,183,0.92)',borderRadius:'21px',color:'#fff',textAlign:'center',fontWeight:'700',lineHeight:'42px',fontSize:'13px'}]});}
      kakao.maps.event.addListener(map,'dragend',emitRegion);
      kakao.maps.event.addListener(map,'zoom_changed',emitRegion);
      kakao.maps.event.addListener(map,'idle',function(){emitRegion();});
      // WebView can initially report a very small height on compact devices.
      // Recalculate Kakao's viewport after the native layout settles or changes.
      var resizeMap=function(){
        if(!map)return;
        var center=map.getCenter();
        kakao.maps.event.trigger(map,'resize');
        if(typeof map.relayout==='function')map.relayout();
        if(center)map.setCenter(center);
      };
      if(typeof ResizeObserver!=='undefined'){
        var observer=new ResizeObserver(function(){resizeMap();});
        observer.observe(mapEl);
      }
      window.addEventListener('resize',resizeMap);
      setTimeout(resizeMap,120);
      setTimeout(resizeMap,500);
      setTimeout(resizeMap,1100);
      document.getElementById('load').style.display='none';
      if(darkModeEnabled)setDarkMode(true);
      post({type:'ready'});
      pending.forEach(apply);pending=[];
    }catch(e){fail('지도 초기화 오류: '+(e&&e.message?e.message:String(e)));}
  }
  if(!${JSON.stringify(JS_KEY)}){
    fail('카카오 JavaScript 키가 앱 빌드에 포함되지 않았습니다. EAS Preview 환경에 EXPO_PUBLIC_KAKAO_JAVASCRIPT_KEY가 등록되어 있는지 확인해주세요.');
    return;
  }
  var sdk=document.createElement('script');
  sdk.src='https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false&libraries=clusterer';
  sdk.onload=function(){
    if(!window.kakao || !window.kakao.maps){fail('SDK 응답은 받았지만 kakao.maps 객체가 없습니다. JavaScript 키 종류와 카카오맵 사용 설정을 확인해주세요.');return;}
    try{kakao.maps.load(initMap);}catch(e){fail('SDK 실행 오류: '+(e&&e.message?e.message:String(e)));}
  };
  sdk.onerror=function(){fail('카카오 SDK 서버 응답을 불러오지 못했습니다. 키·SDK 도메인(https://localhost)·네트워크 또는 API 사용량 제한을 확인해야 합니다.');};
  document.head.appendChild(sdk);
})();
</script></body></html>`;
}

const KakaoMap = forwardRef<KakaoMapHandle, Props>(function KakaoMap(
  { initialRegion, markers, selectedId, searchedIds, compareIds, currentLocation, onRegionChangeComplete, onMarkerPress, darkMode = false },
  ref
) {
  const webRef = useRef<WebView>(null);
  const mapReady = useRef(false);
  const pendingMessages = useRef<string[]>([]);
  const html = useRef(buildHtml(initialRegion, darkMode)).current;
  const sendToMap = useCallback((message: unknown) => {
    const serialized = JSON.stringify(message);
    if (!mapReady.current) {
      const type=(message as any)?.type;
      if(type==="markers"||type==="animate"||type==="theme") pendingMessages.current=pendingMessages.current.filter(item=>JSON.parse(item).type!==type);
      pendingMessages.current.push(serialized);
      return;
    }
    webRef.current?.postMessage(serialized);
  }, []);
  useImperativeHandle(ref, () => ({
    animateToRegion: (region, duration = 400) => {
      sendToMap({ type: "animate", region, duration });
    },
  }), [sendToMap]);
  useEffect(() => {
    sendToMap({ type: "theme", darkMode });
  }, [darkMode, sendToMap]);
  useEffect(() => {
    sendToMap({
      type: "markers",
      markers,
      selectedId: selectedId ?? null,
      searchedIds: searchedIds ?? [],
      compareIds: compareIds ?? [],
      currentLocation: currentLocation ?? null,
    });
  }, [markers, selectedId, searchedIds, compareIds, currentLocation]);
  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === "ready") {
        mapReady.current = true;
        const queued = pendingMessages.current;
        pendingMessages.current = [];
        queued.forEach(serialized => webRef.current?.postMessage(serialized));
        // Re-send the latest marker set after every WebView reload as well.
        webRef.current?.postMessage(JSON.stringify({
          type: "markers",
          markers,
          selectedId: selectedId ?? null,
          searchedIds: searchedIds ?? [],
          compareIds: compareIds ?? [],
          currentLocation: currentLocation ?? null,
        }));
        webRef.current?.postMessage(JSON.stringify({type:"theme",darkMode}));
      }
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
        onLoadStart={() => { mapReady.current = false; }}
        onLoadEnd={() => {
          // The page may have loaded while the Kakao SDK is still initializing.
          // The explicit {type:"ready"} message flushes all queued commands.
        }}
        style={[styles.webview, { backgroundColor: darkMode ? "#1C1C1E" : "#F2F2F7" }]}
      />
    </View>
  );
});
export default KakaoMap;
const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
  webview: { flex: 1 },
});
