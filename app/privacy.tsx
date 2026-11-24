import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const sections=[
 ["1. 개인정보 처리자","발레메이트 운영자 정보와 개인정보 보호책임자 연락처는 출시 전에 확정·기재해야 합니다. 현재 이 문서는 출시 전 검토용 초안입니다."],
 ["2. 처리하는 정보","계정 식별정보와 프로필(인증 제공자가 전달하는 식별자·이메일 등, 닉네임), 즐겨찾기, 커뮤니티 게시글·댓글·신고·차단 정보 및 커뮤니티 이용규칙 동의 기록, 학원 원장 권한 신청 및 학원 관리 이력, 사용자가 업로드한 학원 사진·공지 등이 서비스 기능에 따라 처리될 수 있습니다."],
 ["3. 기기 권한 및 위치정보 이용 동의","위치정보는 앱 내 별도 동의를 받은 뒤 현재 위치 표시와 현재 위치 중심 지도 이동을 위해 기기에서 확인합니다. Android/iOS 기기 위치 권한은 앱 내 동의와 별도로 요청합니다. 주변 학원 검색에는 사용자가 보고 있는 지도 범위 좌표가 Supabase 조회 요청에 포함되며, 현재 GPS 좌표를 앱 데이터베이스에 별도 저장하지 않습니다. 길찾기는 사용자가 선택한 외부 지도 앱으로 연결되며, 출발지 위치 이용 여부와 권한 처리는 해당 지도 앱의 정책을 따릅니다. 동의 또는 기기 권한을 거부해도 직접 지역을 검색하거나 지도를 이동해 탐색할 수 있습니다. 사진 보관함 권한은 사용자가 선택한 학원 사진 등록에 사용합니다."],
 ["4. 처리 목적과 위탁·제공","계정 인증, 즐겨찾기 동기화, 커뮤니티 운영, 학원 정보 관리 및 사진 저장을 위해 Supabase 인프라를 이용합니다. Google·카카오 로그인은 각 인증 제공자의 정책에 따릅니다. 지도 검색 시 지도 범위 좌표가 Supabase로 전달됩니다. 사용자가 직접 올린 학원 사진은 공개 학원 갤러리에서 다른 이용자에게 표시될 수 있습니다. 실제 국외 이전 국가·항목·보유기간과 외부 제공 범위는 운영 설정을 확인해 확정해야 합니다."],
 ["5. 보유 및 파기","회원 탈퇴가 완료되면 계정 프로필, 즐겨찾기, 회원 작성 커뮤니티 글·댓글 등 계정에 연결된 정보를 삭제하도록 처리합니다. 학원 운영 권한은 해제되고 비공개 사업자 서류와 작성자 FK가 필요한 공지사항은 삭제됩니다. 공개된 학원 정보·학원 사진처럼 서비스 자산으로 유지되는 자료는 계정과 분리해 남을 수 있으며, 구체적인 보유 근거와 기간을 출시 전에 확정해야 합니다."],
 ["6. 이용자 권리","회원은 앱의 내 계정 화면에서 탈퇴를 요청할 수 있습니다. 외부 웹 탈퇴 요청 경로와 개인정보 문의처는 출시 전에 이 화면 및 Play Console에 실제 공개 URL·연락처로 등록해야 합니다."],
 ["7. 안전조치","접근 권한 분리, 데이터베이스 RLS, 서버 측 인증 및 비밀키 비공개 등 기술적 보호조치를 적용합니다. 운영 중인 실제 설정과 일치하는지 최종 점검이 필요합니다."],
 ["8. 문의 및 사진 권리 요청","개인정보 보호책임자/문의 이메일: [운영자 이메일 등록 필요] · 운영자/사업자 표기명: [등록 필요]. 학원 사진의 저작권·삭제 요청은 학원 상세의 '학원 정보 제보'에서 '저작권/사진 삭제 요청'을 선택하거나 외부 개인정보처리방침의 문의 이메일로 사진 URL, 원본 출처, 권리자 정보와 요청 사유를 보내 주세요."]
];
export default function Privacy(){
 const router=useRouter();
 return <SafeAreaView style={s.safe}><View style={s.header}><Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable><Text style={s.title}>개인정보처리방침</Text></View><ScrollView contentContainerStyle={s.body}>
  <View style={s.notice}><Text style={s.noticeText}>출시 전 초안 · 운영자 정보, 문의처, 국외 이전 및 보유기간을 확정한 뒤 공개해야 합니다.</Text></View>
  <Text style={s.intro}>발레메이트는 이용자의 개인정보를 보호하기 위해 아래와 같이 처리합니다.</Text>
  <Pressable style={s.external} onPress={()=>Linking.openURL("https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/delete-account")}><Text style={s.externalText}>외부 계정 삭제 요청 페이지 열기 ↗</Text></Pressable>
  {sections.map(([title,body])=><View key={title} style={s.section}><Text style={s.heading}>{title}</Text><Text style={s.text}>{body}</Text></View>)}
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#FAF9FC"},header:{padding:16,borderBottomWidth:1,borderColor:"#EAE7F0"},back:{fontSize:12,color:"#7661D8",fontWeight:"800"},title:{fontSize:20,fontWeight:"900",color:"#252238",marginTop:12},body:{padding:18,paddingBottom:36},notice:{backgroundColor:"#FFF4E5",borderRadius:12,padding:12},noticeText:{fontSize:12,lineHeight:18,color:"#8A4B08",fontWeight:"800"},intro:{fontSize:13,lineHeight:21,color:"#4E4A5C",marginTop:18,marginBottom:4},external:{marginTop:14,padding:12,borderRadius:10,backgroundColor:"#F3F0FF"},externalText:{fontSize:12,color:"#653BB7",fontWeight:"900"},section:{marginTop:18},heading:{fontSize:14,fontWeight:"900",color:"#252238",marginBottom:7},text:{fontSize:12,lineHeight:20,color:"#625E70"}});
