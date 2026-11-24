import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const sections=[
 ["제1조 목적","이 약관은 발레메이트가 제공하는 발레 학원 탐색 및 커뮤니티 서비스의 이용 조건과 절차를 정합니다."],
 ["제2조 서비스","서비스는 학원 위치·기본정보·공개된 가격 및 시간표·사진, 즐겨찾기, 커뮤니티 기능 등을 제공합니다. 서비스 정보는 변경되거나 실제 운영과 다를 수 있으므로 방문·등록 전 학원에 확인해야 합니다."],
 ["제3조 회원 및 계정","일부 기능은 Google 또는 카카오 인증이 필요합니다. 회원은 본인 계정을 안전하게 관리해야 하며, 계정 탈퇴는 앱 내 내 계정 화면에서 요청할 수 있습니다."],
 ["제4조 이용자 콘텐츠","회원은 게시글과 댓글에 필요한 권리를 보유해야 하며 타인의 저작권·초상권·개인정보를 침해하거나 불법·허위·광고성·괴롭힘 콘텐츠를 게시해서는 안 됩니다. 운영자는 신고된 콘텐츠를 검토하고 필요한 조치를 할 수 있습니다."],
 ["제5조 학원 정보와 사진","학원 정보는 공공·공개 출처 및 학원 관계자 제공 자료 등을 바탕으로 표시될 수 있습니다. 정보의 정확성·최신성을 보장하지 않으며 오류 신고가 접수되면 확인 후 수정·비공개 처리할 수 있습니다."],
 ["제6조 금지행위","서비스의 정상 운영을 방해하거나 타인의 권리를 침해하는 행위, 허가받지 않은 자료 수집·복제·재배포, 허위 신고 및 계정 악용을 금지합니다."],
 ["제7조 서비스 변경·중단","운영자는 점검, 외부 서비스 장애, 보안상 필요 등에 따라 기능을 변경하거나 일시 중단할 수 있으며 가능한 경우 사전에 안내합니다."],
 ["제8조 책임 제한","학원 운영정보와 외부 링크는 참고용이며 실제 수업·가격·운영 여부는 해당 학원에 확인해야 합니다. 법령상 허용되지 않는 책임 제한은 적용하지 않습니다."],
 ["제9조 시행 및 운영자 정보","운영자/사업자명과 문의처는 출시 전에 확정·기재해야 합니다. 본 약관은 출시 전 검토용 초안입니다."]
];
export default function Terms(){
 const router=useRouter();
 return <SafeAreaView style={s.safe}><View style={s.header}><Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable><Text style={s.title}>서비스 이용약관</Text></View><ScrollView contentContainerStyle={s.body}>
  <View style={s.notice}><Text style={s.noticeText}>출시 전 초안 · 운영자 정보와 시행일을 확정한 뒤 공개해야 합니다.</Text></View>
  {sections.map(([title,body])=><View key={title} style={s.section}><Text style={s.heading}>{title}</Text><Text style={s.text}>{body}</Text></View>)}
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#FAF9FC"},header:{padding:16,borderBottomWidth:1,borderColor:"#EAE7F0"},back:{fontSize:12,color:"#7661D8",fontWeight:"800"},title:{fontSize:20,fontWeight:"900",color:"#252238",marginTop:12},body:{padding:18,paddingBottom:36},notice:{backgroundColor:"#FFF4E5",borderRadius:12,padding:12},noticeText:{fontSize:12,lineHeight:18,color:"#8A4B08",fontWeight:"800"},section:{marginTop:18},heading:{fontSize:14,fontWeight:"900",color:"#252238",marginBottom:7},text:{fontSize:12,lineHeight:20,color:"#625E70"}});
