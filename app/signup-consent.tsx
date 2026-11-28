import React,{useMemo,useRef,useState} from "react";
import {Alert,Modal,Pressable,ScrollView,StyleSheet,Text,View,useColorScheme} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {WebView} from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {useLocalSearchParams,useRouter} from "expo-router";
import {TERMS_SECTIONS} from "./terms";

export const SIGNUP_CONSENT_STORAGE_KEY="balletmate.signupConsent.v1";
export const TERMS_VERSION="2026-11-26";
export const PRIVACY_VERSION="2026-11-26";
const PRIVACY_URL="https://dlehdrb554-netizen.github.io/balletmate/privacy-policy.html";
const C={purple:"#653BB7",ink:"#252238",muted:"#625E70",line:"#EAE7F0",pale:"#F3F0FF"};
const escapeHtml=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const TERMS_HTML=`<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif;color:#292536;line-height:1.8;padding:20px;margin:0;word-break:keep-all}h2{font-size:17px;margin:24px 0 8px}p{font-size:14px;white-space:pre-wrap;margin:0}</style></head><body><h1>발레메이트 서비스 이용약관</h1><p>아래 약관 전문을 끝까지 읽어 주세요.</p>${TERMS_SECTIONS.map(([title,body])=>`<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>`).join("")}</body></html>`;
const SCROLL_SCRIPT=`(()=>{let sent=false;const check=()=>{const d=document.documentElement,b=document.body;const top=window.pageYOffset||d.scrollTop||b.scrollTop;const height=Math.max(d.scrollHeight,b.scrollHeight);if(top+window.innerHeight>=height-12&&!sent){sent=true;window.ReactNativeWebView.postMessage("BOTTOM");}};window.addEventListener("scroll",check,{passive:true});setTimeout(check,400);setTimeout(check,1200);})();true;`;

export default function SignupConsent(){
 const dark=useColorScheme()==="dark";
 const s=useMemo(()=>styles(dark),[dark]);
 const router=useRouter();
 const params=useLocalSearchParams<{next?:string}>();
 const webViewRef=useRef<WebView>(null);
 const [activeDoc,setActiveDoc]=useState<"terms"|"privacy"|null>(null);
 const [docReachedEnd,setDocReachedEnd]=useState(false);
 const [termsRead,setTermsRead]=useState(false);
 const [privacyRead,setPrivacyRead]=useState(false);
 const [termsAgreed,setTermsAgreed]=useState(false);
 const [privacyAgreed,setPrivacyAgreed]=useState(false);
 const [ageAgreed,setAgeAgreed]=useState(false);
 const openDoc=(doc:"terms"|"privacy")=>{setDocReachedEnd(false);setActiveDoc(doc);};
 const closeDoc=()=>{if(!docReachedEnd)return;if(activeDoc==="terms")setTermsRead(true);if(activeDoc==="privacy")setPrivacyRead(true);setActiveDoc(null);};
 const ready=termsRead&&privacyRead&&termsAgreed&&privacyAgreed&&ageAgreed;
 const continueSignup=async()=>{
  if(!ready)return;
  const acceptedAt=new Date().toISOString();
  try{
   await AsyncStorage.setItem(SIGNUP_CONSENT_STORAGE_KEY,JSON.stringify({termsVersion:TERMS_VERSION,privacyVersion:PRIVACY_VERSION,acceptedAt,age14Confirmed:true}));
   if(params.next==="email")router.replace("/signup");
   else if(params.next==="google"||params.next==="kakao")router.replace({pathname:"/account",params:{consentProvider:params.next}});
   else router.replace("/account");
  }catch{Alert.alert("저장 실패","동의 정보를 저장하지 못했습니다. 다시 시도해 주세요.");}
 };
 const consentRow=(title:string,description:string,read:boolean,checked:boolean,onPress:()=>void,onCheck:()=>void)=>(
  <View style={s.row}>
   <Pressable style={s.rowMain} onPress={onPress} accessibilityRole="button">
    <View style={s.rowCopy}><Text style={s.rowTitle}>{title}</Text><Text style={s.rowDescription}>{description}</Text><Text style={s.readHint}>{read?"전문 확인 완료":"눌러서 약관 전문 읽기 ›"}</Text></View>
    <Text style={s.arrow}>›</Text>
   </Pressable>
   <Pressable style={[s.checkButton,checked&&s.checked]} disabled={!read} onPress={onCheck} accessibilityRole="checkbox" accessibilityState={{checked,disabled:!read}}>
    <Text style={[s.checkMark,checked&&s.checkedMark]}>{checked?"✓":""}</Text>
   </Pressable>
  </View>
 );
 return <SafeAreaView style={s.safe}>
  <View style={s.header}>
   <Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable>
   <Text style={s.title}>가입 전 필수 동의</Text>
   <Text style={s.subtitle}>발레메이트 가입을 위해 아래 내용을 확인해 주세요.</Text>
  </View>
  <ScrollView contentContainerStyle={s.body}>
   <View style={s.notice}><Text style={s.noticeTitle}>필수 항목 3개</Text><Text style={s.noticeText}>약관 전문을 열어 마지막까지 스크롤하면 동의 체크가 활성화됩니다.</Text></View>
   {consentRow("이용 약관동의 (필수)","서비스 이용 조건 및 회원의 권리·의무",termsRead,termsAgreed,()=>openDoc("terms"),()=>setTermsAgreed(v=>!v))}
   {consentRow("개인정보 수집동의 (필수)","개인정보 처리 목적·항목·보유기간 확인",privacyRead,privacyAgreed,()=>openDoc("privacy"),()=>setPrivacyAgreed(v=>!v))}
   <View style={s.row}>
    <View style={s.rowMain}><View style={s.rowCopy}><Text style={s.rowTitle}>만 14세 이상입니다 (필수)</Text><Text style={s.rowDescription}>만 14세 미만은 보호자 동의 등 별도 절차가 필요합니다.</Text></View></View>
    <Pressable style={[s.checkButton,ageAgreed&&s.checked]} onPress={()=>setAgeAgreed(v=>!v)} accessibilityRole="checkbox" accessibilityState={{checked:ageAgreed}}><Text style={[s.checkMark,ageAgreed&&s.checkedMark]}>{ageAgreed?"✓":""}</Text></Pressable>
   </View>
   <Text style={s.footnote}>각 전문을 끝까지 확인한 후 체크할 수 있으며, 필수 항목에 모두 동의해야 가입 방식 선택으로 이동합니다.</Text>
   <Pressable style={[s.primary,!ready&&s.disabled]} disabled={!ready} onPress={continueSignup}><Text style={s.primaryText}>동의하고 가입 방식 선택</Text></Pressable>
  </ScrollView>
  <Modal visible={!!activeDoc} animationType="slide" onRequestClose={()=>setActiveDoc(null)}>
   <SafeAreaView style={s.modalSafe}>
    <View style={s.modalHeader}><Pressable onPress={()=>setActiveDoc(null)}><Text style={s.back}>‹ 닫기</Text></Pressable><Text style={s.modalTitle}>{activeDoc==="terms"?"서비스 이용약관":"개인정보 처리방침"}</Text></View>
    {activeDoc&&<WebView key={activeDoc} source={activeDoc==="terms"?{html:TERMS_HTML}:{uri:PRIVACY_URL}} ref={webViewRef} onLoadEnd={()=>webViewRef.current?.injectJavaScript(SCROLL_SCRIPT)} onMessage={event=>{if(event.nativeEvent.data==="BOTTOM")setDocReachedEnd(true);}} javaScriptEnabled domStorageEnabled/>}
    <View style={s.modalFooter}><Text style={s.modalHint}>{docReachedEnd?"전문을 끝까지 확인했습니다.":"전문을 맨 아래까지 스크롤해 주세요."}</Text><Pressable style={[s.primary,s.modalButton,!docReachedEnd&&s.disabled]} disabled={!docReachedEnd} onPress={closeDoc}><Text style={s.primaryText}>확인하고 돌아가기</Text></Pressable></View>
   </SafeAreaView>
  </Modal>
 </SafeAreaView>;
}
const styles=(dark:boolean)=>StyleSheet.create({
 safe:{flex:1,backgroundColor:dark?"#101014":"#FAF9FC"},
 header:{paddingHorizontal:20,paddingTop:12,paddingBottom:18,borderBottomWidth:1,borderColor:dark?"#383342":C.line},
 back:{fontSize:13,fontWeight:"800",color:dark?"#B9A8FF":C.purple,paddingVertical:7},
 title:{fontSize:24,fontWeight:"900",color:dark?"#F5F3FA":C.ink,marginTop:12},
 subtitle:{fontSize:13,lineHeight:20,color:dark?"#B8B2C4":C.muted,marginTop:8},
 body:{padding:20,paddingBottom:36},
 notice:{padding:15,borderRadius:14,backgroundColor:dark?"#292337":C.pale,marginBottom:14},
 noticeTitle:{fontSize:13,fontWeight:"900",color:dark?"#C8B8FF":C.purple},
 noticeText:{fontSize:12,lineHeight:18,color:dark?"#D0CADB":C.muted,marginTop:5},
 row:{flexDirection:"row",alignItems:"center",padding:15,borderWidth:1,borderColor:dark?"#393342":C.line,borderRadius:15,backgroundColor:dark?"#1B1A20":"#FFFFFF",marginTop:10},
 rowMain:{flex:1,flexDirection:"row",alignItems:"center",paddingRight:8},
 rowCopy:{flex:1},
 rowTitle:{fontSize:14,fontWeight:"900",color:dark?"#F5F3FA":C.ink},
 rowDescription:{fontSize:11,lineHeight:17,color:dark?"#B8B2C4":C.muted,marginTop:5},
 readHint:{fontSize:11,fontWeight:"800",color:dark?"#B9A8FF":C.purple,marginTop:7},
 arrow:{fontSize:24,color:dark?"#B9A8FF":C.purple,marginLeft:8},
 checkButton:{width:28,height:28,borderRadius:8,borderWidth:1.5,borderColor:dark?"#655B75":"#B8B1C5",alignItems:"center",justifyContent:"center",marginLeft:8},
 checked:{backgroundColor:C.purple,borderColor:C.purple},
 checkMark:{fontSize:18,fontWeight:"900",color:"transparent",lineHeight:21},
 checkedMark:{color:"#FFFFFF"},
 footnote:{fontSize:11,lineHeight:18,color:dark?"#AAA3B5":C.muted,marginTop:16},
 primary:{height:52,borderRadius:13,backgroundColor:C.purple,alignItems:"center",justifyContent:"center",marginTop:24},
 disabled:{opacity:.4},
 primaryText:{fontSize:14,fontWeight:"900",color:"#FFFFFF"},
 modalSafe:{flex:1,backgroundColor:dark?"#101014":"#FFFFFF"},
 modalHeader:{paddingHorizontal:18,paddingVertical:10,borderBottomWidth:1,borderColor:dark?"#383342":C.line},
 modalTitle:{fontSize:18,fontWeight:"900",color:dark?"#F5F3FA":C.ink,paddingBottom:8},
 modalFooter:{padding:14,borderTopWidth:1,borderColor:dark?"#383342":C.line,backgroundColor:dark?"#17151D":"#FFFFFF"},
 modalHint:{fontSize:12,color:dark?"#C3BDCE":C.muted,textAlign:"center"},
 modalButton:{marginTop:10}
});
