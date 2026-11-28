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

function buildHtml(initialRegion: MapRegion) {
  // Theme is intentionally excluded from HTML so color-scheme changes never rebuild the WebView document.
  const initialSurface = "#F2F2F7";
  const center = JSON.stringify({ lat: initialRegion.latitude, lng: initialRegion.longitude });
  const level = Math.max(1, Math.min(14, Math.round(7 + Math.log2(initialRegion.latitudeDelta / 0.06))));
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="color-scheme" content="${darkMode ? "dark" : "light"}">
<style>*{box-sizing:border-box}:root{--map-tile-filter:${darkMode ? "brightness(0.68) saturate(0.82)" : "none"}}html,body,#map{width:100%;height:100%;margin:0;padding:0;overflow:hidden;background-color:${initialSurface}}#map img[src*="map_2d"]{filter:var(--map-tile-filter,none)} .load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7661D8;font:14px sans-serif;background:${initialSurface};z-index:2}</style>
</head>
<body><div id="map"></div><div id="load" class="load">지도를 불러오는 중…</div>
<script>
(function(){
  var map=null, markers={}, markerMeta={}, markerListeners={}, clusterer=null, currentMarker=null, currentLocationMeta=null, pending=[], currentSelected=null, currentSearched=[], currentCompared=[], darkModeEnabled=false, regionTimer=null;
  var cachedPinImages={};
  function post(data){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(data)); }catch(e){} }
  function levelFor(delta){ return Math.max(1,Math.min(14,Math.round(7+Math.log2(Math.max(delta,0.001)/0.06)))); }
  function markerState(id, selectedId, searchedIds, compareIds){
    if(id===selectedId)return 'selected';
    return 'default';
  }
  function pinImage(state){
    state=state||'default';
    if(cachedPinImages[state])return cachedPinImages[state];
    var colors={selected:'#FF5A1F',default:'#B99CFF'};
    var color=colors[state]||colors.default;
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path d="M17 1C8.2 1 1 8.2 1 17c0 11 16 24 16 24s16-13 16-24C33 8.2 25.8 1 17 1z" fill="'+color+'" stroke="white" stroke-width="2.5"/><circle cx="17" cy="17" r="5" fill="white"/></svg>';
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
        var marker=new kakao.maps.Marker({position:pos,image:pinImage(markerState(item.id,selectedId,currentSearched,currentCompared)),title:item.name,zIndex:100});
        // Render pins directly on the Kakao map. Clusterer batching caused
        // newly searched markers to remain invisible until the map was moved.
        marker.setMap(map);
        markerListeners[item.id]=function(){updateSelectedMarker(item.id);post({type:'marker',id:item.id});};
        kakao.maps.event.addListener(marker,'click',markerListeners[item.id]);
        markers[item.id]=marker;
        markerMeta[item.id]={latitude:item.latitude,longitude:item.longitude,name:item.name,state:markerState(item.id,selectedId,currentSearched,currentCompared)};
      }else{
        var marker=markers[item.id], meta=markerMeta[item.id]||{};
        if(meta.latitude!==item.latitude||meta.longitude!==item.longitude)marker.setPosition(pos);
        // Keep studio pins above map tiles and ordinary map overlays after theme changes.
        if(typeof marker.setZIndex==='function')marker.setZIndex(100);
        var state=markerState(item.id,selectedId,currentSearched,currentCompared);
        if(meta.state!==state)marker.setImage(pinImage(state));
        if(meta.name!==item.name)marker.setTitle(item.name);
        markerMeta[item.id]={latitude:item.latitude,longitude:item.longitude,name:item.name,state:state};
      }
    });
    // Batch marker registration to avoid repeated clusterer work for large search results.
    // Direct markers are already attached to the map; no clusterer redraw needed.
    Object.keys(markers).forEach(function(id){if(!keep[id]){if(clusterer)clusterer.removeMarker(markers[id],true);kakao.maps.event.removeListener(markers[id],'click',markerListeners[id]);markers[id].setMap(null);delete markers[id];delete markerMeta[id];delete markerListeners[id];}});

    if(location && location.latitude!=null && location.longitude!=null){
      var here=new kakao.maps.LatLng(location.latitude,location.longitude);
      if(!currentMarker){var locationSvg='<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="#ffffff" stroke="#3478F6" stroke-width="3"/><circle cx="18" cy="18" r="7" fill="#3478F6"/><circle cx="18" cy="18" r="3" fill="#ffffff"/></svg>';currentMarker=new kakao.maps.Marker({position:here,image:new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(locationSvg),new kakao.maps.Size(36,36),{offset:new kakao.maps.Point(18,18)}),zIndex:1000});currentMarker.setMap(map);}
      else if(!currentLocationMeta||currentLocationMeta.latitude!==location.latitude||currentLocationMeta.longitude!==location.longitude)currentMarker.setPosition(here);
      currentLocationMeta={latitude:location.latitude,longitude:location.longitude};
    }else if(currentMarker){currentMarker.setMap(null);currentMarker=null;currentLocationMeta=null;}
  }
  var programmaticMove=false;
  var programmaticMoveTimer=null;
  function moveTo(region,duration){
    if(!map||!region)return;
    programmaticMove=true;
    if(programmaticMoveTimer)clearTimeout(programmaticMoveTimer);
    programmaticMoveTimer=setTimeout(function(){programmaticMove=false;programmaticMoveTimer=null;},Math.max(500,Math.min(1200,(duration||400)+350)));
    var center=new kakao.maps.LatLng(region.latitude,region.longitude);
    var targetLevel=levelFor(region.latitudeDelta);
    var currentLevel=map.getLevel();
    if(currentLevel!==targetLevel){
      map.setLevel(targetLevel,{animate:false});
      map.setCenter(center);
    }else{
      map.panTo(center);
    }
  }
  function emitRegion(){
    if(!map||programmaticMove)return;
    if(regionTimer)clearTimeout(regionTimer);
    regionTimer=setTimeout(function(){emitRegionNow();},350);
  }
  function emitRegionNow(){
    if(!map)return;
    var center=map.getCenter(), bounds=map.getBounds(), sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    post({type:'region',region:{latitude:center.getLat(),longitude:center.getLng(),latitudeDelta:Math.max(0.002,ne.getLat()-sw.getLat()),longitudeDelta:Math.max(0.002,ne.getLng()-sw.getLng())}});
  }
  function setDarkMode(enabled){
    darkModeEnabled=!!enabled;
    var load=document.getElementById('load');
    var surface=darkModeEnabled?'#1C1C1E':'#F2F2F7';
    var tileFilter=darkModeEnabled?'brightness(0.68) saturate(0.82)':'none';
    document.documentElement.style.backgroundColor=surface;
    document.documentElement.style.colorScheme=darkModeEnabled?'dark':'light';
    document.documentElement.style.setProperty('--map-tile-filter',tileFilter);
    document.body.style.backgroundColor=surface;
    document.getElementById('map').style.backgroundColor=surface;
    // The CSS custom property above updates all current and future tiles.
    // Avoid walking every Kakao tile image on the JS thread during theme changes.
    if(load)load.style.backgroundColor=surface;
    var colorScheme=document.querySelector('meta[name="color-scheme"]');
    if(colorScheme)colorScheme.setAttribute('content',darkModeEnabled?'dark':'light');
    // Re-attach existing markers after the map surface/theme has changed; do not recreate marker data.
    Object.keys(markers).forEach(function(id){
      if(markers[id]){
        markers[id].setMap(map);
        if(typeof markers[id].setZIndex==='function')markers[id].setZIndex(100);
      }
    });
    if(currentMarker){currentMarker.setMap(map);if(typeof currentMarker.setZIndex==='function')currentMarker.setZIndex(1000);}
    refreshMarkerImages();
  }
  function apply(message){
    if(!map){pending.push(message);return;}
    if(message.type==='markers')updateMarkers(message.markers,message.selectedId,message.searchedIds,message.compareIds,message.currentLocation);
    if(message.type==='animate')moveTo(message.region,message.duration);
    if(message.type==='setTheme')setDarkMode(!!message.isDark);
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
      // Clusterer disabled: direct Marker.setMap(map) keeps search results immediately visible.
      kakao.maps.event.addListener(map,'dragstart',function(){if(programmaticMoveTimer){clearTimeout(programmaticMoveTimer);programmaticMoveTimer=null;}programmaticMove=false;});
      kakao.maps.event.addListener(map,'zoom_start',function(){if(programmaticMoveTimer){clearTimeout(programmaticMoveTimer);programmaticMoveTimer=null;}programmaticMove=false;});
      kakao.maps.event.addListener(map,'dragend',emitRegion);
      kakao.maps.event.addListener(map,'zoom_changed',emitRegion);
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
  const html = useRef(buildHtml(initialRegion)).current;
  const sendToMap = useCallback((message: unknown) => {
    const serialized = JSON.stringify(message);
    if (!mapReady.current) {
      const type=(message as any)?.type;
      if(type==="markers"||type==="animate"||type==="setTheme") pendingMessages.current=pendingMessages.current.filter(item=>JSON.parse(item).type!==type);
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
    sendToMap({ type: "setTheme", isDark: darkMode });
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
        webRef.current?.postMessage(JSON.stringify({type:"setTheme",isDark:darkMode}));
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
        style={[styles.webview, { backgroundColor: "#F2F2F7" }]}
      />
    </View>
  );
});
export default KakaoMap;
const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden" },
  webview: { flex: 1 },
});
