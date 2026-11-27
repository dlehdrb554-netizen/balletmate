import React, {useMemo, useState} from "react";
import {themeStyles} from "../lib/theme";
import {Ionicons} from "@expo/vector-icons";
import {Pressable, ScrollView, StyleSheet, Text, View, useColorScheme} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";

const sections=[
 {title:"제1항. 상호 존중",summary:"서로의 경험과 의견을 존중해 주세요.",body:"욕설, 비방, 괴롭힘, 협박, 차별·혐오 표현, 특정 회원이나 학원을 향한 인신공격은 허용하지 않습니다. 의견이 다를 때는 경험과 사실을 중심으로 정중하게 이야기해 주세요."},
 {title:"제2항. 광고·홍보 및 도배",summary:"정보 공유 목적의 게시글을 작성해 주세요.",body:"운영자 허가 없는 반복 광고, 영리 목적의 홍보, 동일·유사 게시물 반복 등록, 외부 구매 유도, 스팸 링크 및 사기는 제한됩니다. 학원이나 상품을 추천할 때는 실제 이용 경험과 정보 중심으로 작성하고, 이해관계나 협찬이 있다면 명확히 밝혀 주세요."},
 {title:"제3항. 개인정보 보호",summary:"나와 다른 회원의 개인정보를 지켜 주세요.",body:"본인 또는 타인의 전화번호, 상세 주소, 이메일, 계정 정보, 결제·예약 정보 등 개인을 식별하거나 연락할 수 있는 정보를 공개하지 마세요. 사진을 올릴 때에도 이름표, 연락처, 차량번호, 위치 정보 등이 노출되지 않았는지 확인해 주세요."},
 {title:"제4항. 저작권·초상권 및 권리 보호",summary:"게시할 권리가 있는 사진과 글만 공유해 주세요.",body:"타인이 촬영한 사진, 영상, 글, 시간표·자료 등을 허락 없이 복제하거나 게시하지 마세요. 사진에 다른 사람이 식별 가능하게 등장한다면 필요한 동의를 확인해 주세요. 학원 내부 사진이나 수업 장면도 촬영·게시 허용 여부를 확인해 주세요."},
 {title:"제5항. 허위 정보 및 부적절한 콘텐츠",summary:"사실에 근거한 정확한 정보를 나눠 주세요.",body:"허위 후기·조작 리뷰, 확인되지 않은 사실을 단정하는 글, 사기·불법행위 조장, 음란·폭력적 콘텐츠, 타인의 명예나 권리를 침해하는 내용은 제한됩니다. 경험과 추측, 확인된 사실을 구분해 작성해 주세요."},
 {title:"제재 및 이의제기",summary:"위반 정도와 반복 여부를 고려해 조치합니다.",body:"운영자는 신고 또는 자체 확인을 통해 콘텐츠를 검토합니다. 위반 내용과 심각도에 따라 안내·수정 요청, 콘텐츠 숨김 또는 삭제, 일정 기간 글·댓글 작성 제한, 계정 이용 제한 순으로 조치할 수 있습니다. 개인정보 노출이나 사기 등 긴급하거나 중대한 사안은 사전 안내 없이 콘텐츠를 우선 제한할 수 있습니다. 조치 알림에는 해당 기준 항목과 사유를 함께 안내하며, 문의가 필요한 경우 앱 내 문의 기능을 이용해 주세요."}
];
export default function CommunityPolicy(){
 const dark=useColorScheme()==="dark";
 const s=useMemo(()=>createStyles(dark),[dark]);
 const router=useRouter();
 const [expanded,setExpanded]=useState<number|null>(0);
 return <SafeAreaView style={s.safe}>
  <View style={s.header}>
   <Pressable onPress={()=>router.back()} style={s.back}><Ionicons name="chevron-back" size={18} color={dark?"#C9B9FF":"#653BB7"}/><Text style={s.backText}>커뮤니티</Text></Pressable>
   <Text style={s.title}>커뮤니티 운영정책</Text>
   <Text style={s.subtitle}>모두가 편안하게 발레 이야기를 나누기 위한 약속입니다.</Text>
  </View>
  <ScrollView contentContainerStyle={s.content}>
   <View style={s.notice}><Text style={s.noticeTitle}>좋은 커뮤니티를 함께 만들어요</Text><Text style={s.noticeText}>경험은 구체적으로, 표현은 다정하게. 게시하기 전에 개인정보와 사진 사용 권한을 한 번 더 확인해 주세요.</Text></View>
   {sections.map((item,index)=><View key={item.title} style={s.section}>
    <Pressable style={s.sectionHead} onPress={()=>setExpanded(current=>current===index?null:index)} accessibilityRole="button" accessibilityState={{expanded:expanded===index}}>
     <View style={s.sectionText}><Text style={s.sectionTitle}>{item.title}</Text><Text style={s.summary}>{item.summary}</Text></View>
     <Ionicons name={expanded===index?"chevron-up":"chevron-down"} size={18} color={dark?"#B9A7FF":"#653BB7"}/>
    </Pressable>
    {expanded===index&&<Text style={s.body}>{item.body}</Text>}
   </View>)}
   <Text style={s.footer}>운영정책 버전: 2026.11.27</Text>
  </ScrollView>
 </SafeAreaView>;
}
const createStyles=(dark:boolean)=>StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:dark?"#101010":"#FAF9FC"},
 header:{paddingHorizontal:18,paddingTop:12,paddingBottom:16,borderBottomWidth:1,borderColor:dark?"#302B3A":"#EAE7F0"},
 back:{flexDirection:"row",alignItems:"center",gap:4,alignSelf:"flex-start",paddingVertical:5},
 backText:{fontSize:12,fontWeight:"800",color:dark?"#C9B9FF":"#653BB7"},
 title:{fontSize:21,fontWeight:"900",color:dark?"#F5F2FA":"#252238",marginTop:12},
 subtitle:{fontSize:12,color:dark?"#B8B1C4":"#625E70",marginTop:6,lineHeight:18},
 content:{padding:15,paddingBottom:30},
 notice:{backgroundColor:dark?"#272133":"#F0EBFF",borderRadius:15,padding:15,marginBottom:13},
 noticeTitle:{fontSize:14,fontWeight:"900",color:dark?"#D8CCFF":"#5530A0"},
 noticeText:{fontSize:12,lineHeight:19,color:dark?"#D0C9DD":"#625E70",marginTop:6},
 section:{backgroundColor:dark?"#1B1B1B":"#FFFFFF",borderWidth:1,borderColor:dark?"#34303C":"#EAE7F0",borderRadius:13,marginBottom:9,overflow:"hidden"},
 sectionHead:{flexDirection:"row",alignItems:"center",padding:14,gap:10},
 sectionText:{flex:1},
 sectionTitle:{fontSize:13,fontWeight:"900",color:dark?"#F2EEF8":"#252238"},
 summary:{fontSize:11,color:dark?"#B8B1C4":"#625E70",marginTop:5},
 body:{fontSize:12,lineHeight:20,color:dark?"#D0C9DD":"#514D5D",paddingHorizontal:14,paddingBottom:15},
 footer:{fontSize:10,color:dark?"#8D8798":"#8A8495",textAlign:"right",marginTop:8}
},dark));
