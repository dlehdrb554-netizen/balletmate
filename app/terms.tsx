import React, {useMemo} from "react";
import {themeStyles } from "../lib/theme";
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const sections=[
 ["제1조 목적","이 약관은 발레메이트(이하 “서비스”)의 운영자 이동규(이하 “운영자”)가 제공하는 발레 학원 정보 탐색 및 이용자 커뮤니티 서비스의 이용 조건, 권리·의무 및 책임 사항을 정합니다."],
 ["제2조 용어의 정의","“회원”은 서비스에 가입하여 이용하는 사람을 말합니다. “콘텐츠”는 회원이 작성하거나 등록한 리뷰, 게시글, 댓글, 사진 등 일체의 자료를 말합니다. “학원 정보”는 학원의 위치, 연락처, 수업, 가격, 시간표 및 공지 등 서비스에 표시되는 정보를 말합니다."],
 ["제3조 약관의 게시와 변경","운영자는 약관을 서비스 화면에 게시합니다. 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 내용과 시행일을 시행일 전에 서비스 내 공지하는 것을 원칙으로 합니다. 회원에게 불리하거나 중요한 변경은 합리적인 기간을 두고 별도로 안내합니다. 회원은 변경 약관에 동의하지 않을 경우 서비스 이용을 중단하고 탈퇴할 수 있습니다."],
 ["제4조 회원가입 및 계정","회원가입은 서비스가 제공하는 인증 절차를 완료하고 필요한 정보를 등록한 때 성립합니다. 회원은 정확한 정보를 제공하고 계정 및 인증수단을 안전하게 관리해야 합니다. 타인의 계정을 사용하거나 계정을 양도·대여해서는 안 됩니다. 회원정보가 변경되면 서비스에서 수정해야 합니다."],
 ["제5조 서비스의 제공","서비스는 학원 검색·지도 표시·상세정보, 공개된 가격 및 시간표, 즐겨찾기, 알림, 리뷰 및 커뮤니티 기능을 제공합니다. 서비스는 운영상·기술상 필요한 경우 기능을 추가·변경하거나 일시 중단할 수 있으며, 중요한 변경은 가능한 범위에서 사전에 안내합니다."],
 ["제6조 학원 정보의 정확성","학원 정보는 공공기관 공개자료, 지도 서비스, 학원 관계자 또는 이용자 제보 등을 통해 수집·갱신될 수 있습니다. 운영자는 정보의 정확성·완전성·최신성을 보장하지 않습니다. 수업 운영, 가격, 시간표, 등록 여부 및 시설 이용 가능 여부는 방문 또는 등록 전에 해당 학원에 직접 확인해야 합니다. 오류 제보가 접수되면 확인 후 수정·비공개할 수 있습니다."],
 ["제7조 이용자 콘텐츠 및 운영정책","회원은 리뷰·게시글·댓글·사진을 등록할 때 사실에 근거하고 타인의 권리를 존중해야 합니다. 허위·조작 리뷰, 광고·스팸, 도배, 욕설·괴롭힘, 차별·혐오, 음란·폭력적 내용, 불법행위 조장, 개인정보 또는 초상권·저작권 침해 콘텐츠를 게시해서는 안 됩니다. 회원은 등록한 콘텐츠에 필요한 권리와 동의를 확보해야 합니다."],
 ["제8조 콘텐츠의 이용 및 관리","회원은 콘텐츠에 대한 권리를 보유합니다. 회원은 서비스 운영·표시·검색·신고 검토를 위해 필요한 범위에서 운영자에게 콘텐츠를 서비스 내 제공·노출할 수 있는 비독점적 이용을 허락합니다. 운영자는 신고, 법령 위반, 타인 권리 침해 또는 서비스 운영정책 위반이 확인되거나 합리적으로 의심되는 콘텐츠를 임시 숨김, 삭제 또는 접근 제한할 수 있습니다. 반복 위반 계정은 기능 제한 또는 이용 정지될 수 있습니다."],
 ["제9조 금지행위","회원은 서비스 또는 서버에 대한 비정상 접근·공격, 자동화된 대량 수집, 서비스 데이터의 무단 복제·재배포, 허위 신고, 리뷰 조작, 타인 사칭, 영리 목적의 무단 광고, 법령 위반 행위를 해서는 안 됩니다."],
 ["제10조 서비스 이용 제한","운영자는 회원이 약관 또는 법령을 위반한 경우 위반 정도, 반복 여부 및 긴급성을 고려하여 콘텐츠 숨김·삭제, 작성 제한, 계정 이용 제한 등의 조치를 할 수 있습니다. 가능한 경우 조치 사유와 이의제기 방법을 안내합니다. 법령상 긴급한 조치가 필요한 경우 사후 안내할 수 있습니다."],
 ["제11조 회원 탈퇴 및 데이터 처리","회원은 앱 내 계정 메뉴에서 탈퇴를 요청할 수 있습니다. 탈퇴 시 개인정보는 개인정보 처리방침 및 관련 법령에 따라 처리됩니다. 법령상 보존 의무가 있거나 다른 회원의 권리 보호 및 서비스 운영을 위해 필요한 공개 학원 정보 등은 개인정보를 제거하거나 작성자 식별이 불가능한 형태로 남을 수 있습니다."],
 ["제12조 면책 및 책임","운영자는 천재지변, 통신·플랫폼 장애, 외부 서비스 중단 등 운영자의 합리적인 통제 범위를 벗어난 사유로 발생한 서비스 중단에 대해 법령이 허용하는 범위에서 책임을 부담하지 않습니다. 회원 간 또는 회원과 학원 간 분쟁은 당사자 간 해결을 원칙으로 하되, 운영자는 서비스 운영 범위에서 신고 및 정보 정정 절차를 제공할 수 있습니다. 고의 또는 중대한 과실 등 법령상 면책이 허용되지 않는 책임은 제외되지 않습니다."],
 ["제13조 개인정보 보호","개인정보의 수집·이용·보관·파기 및 회원의 권리는 서비스에 게시된 개인정보 처리방침에 따릅니다. 본 약관은 개인정보 처리방침을 대체하지 않습니다."],
 ["제14조 준거법 및 분쟁 해결","본 약관은 대한민국 법령에 따라 해석·적용됩니다. 서비스 이용과 관련한 분쟁은 당사자 간 협의하여 해결하며, 협의가 이루어지지 않을 경우 관계 법령이 정하는 관할 법원에 따릅니다."],
 ["제15조 광고의 게재","운영자는 서비스 운영 및 유지에 필요한 비용을 충당하기 위해 서비스 화면의 일부에 광고를 게재할 수 있습니다. 광고가 게재되는 경우 일반 학원 정보 및 이용자 콘텐츠와 명확히 구분하여 표시하며, 검색·지도·리뷰 등 주요 기능의 이용을 부당하게 방해하지 않도록 합니다. 광고는 광고주 또는 광고 제공 사업자가 제공할 수 있으며, 광고에 표시된 상품·서비스의 내용과 거래에 관한 책임은 관련 법령에 따라 해당 광고주 등에게 있습니다. 광고 제공을 위해 외부 광고 사업자의 SDK 또는 서비스가 도입되는 경우 수집·이용되는 정보와 제3자 제공·처리 내역은 실제 적용 내용에 맞춰 개인정보 처리방침 및 필요한 동의 절차를 통해 안내합니다."],
 ["제16조 운영자 및 시행일","서비스명: 발레메이트\n운영자: 이동규\n문의 이메일: dlehdrb554@gmail.com\n시행일: 2026년 11월 26일"]
];
export default function Terms(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();
 return <SafeAreaView style={s.safe}><View style={s.header}><Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable><Text style={s.title}>서비스 이용약관</Text></View><ScrollView contentContainerStyle={s.body}>
  {sections.map(([title,body])=><View key={title} style={s.section}><Text style={s.heading}>{title}</Text><Text style={s.text}>{body}</Text></View>)}
  <View style={s.policyLink}><Text style={s.policyHint}>개인정보 처리에 관한 자세한 내용은 개인정보처리방침에서 확인할 수 있습니다.</Text><Pressable onPress={()=>router.push("/privacy")}><Text style={s.policyButton}>개인정보처리방침 확인 ›</Text></Pressable></View>
 </ScrollView></SafeAreaView>;
}
const createS = (dark:boolean) => StyleSheet.create(themeStyles({safe:{flex:1,backgroundColor:"#FAF9FC"},header:{padding:16,borderBottomWidth:1,borderColor:"#EAE7F0"},back:{fontSize:12,color:"#7661D8",fontWeight:"800"},title:{fontSize:20,fontWeight:"900",color:"#252238",marginTop:12},body:{padding:18,paddingBottom:36},notice:{backgroundColor:"#FFF4E5",borderRadius:12,padding:12},noticeText:{fontSize:12,lineHeight:18,color:"#8A4B08",fontWeight:"800"},policyLink:{marginTop:28,padding:16,borderRadius:12,backgroundColor:isDark?"#24212D":"#F0EDFA"},policyHint:{fontSize:12,lineHeight:19,color:isDark?"#C9C3D8":"#625E70"},policyButton:{fontSize:13,fontWeight:"900",color:isDark?"#B6A8FF":"#6650C8",marginTop:10},section:{marginTop:18},heading:{fontSize:14,fontWeight:"900",color:"#252238",marginBottom:7},text:{fontSize:12,lineHeight:20,color:"#625E70"}},dark));
