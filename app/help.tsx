import React, {useMemo, useState} from "react";
import {themeStyles } from "../lib/theme";
import {Pressable, ScrollView, StyleSheet, Text, View, Linking, useColorScheme} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";
const rows=[
 ["회원가입 없이 학원을 검색할 수 있나요?","네. 지도에서 지역을 검색하고 학원 상세정보를 확인하는 기능은 로그인 없이 이용할 수 있습니다. 찜 목록 동기화 등 일부 기능은 로그인이 필요합니다."],
 ["학원 정보가 잘못되어 있어요.","학원 상세정보 화면의 ‘학원 오류 제보’를 이용해 주세요. 학원명, 잘못된 항목과 수정 내용을 구체적으로 알려주시면 확인 후 반영합니다."],
 ["학원 가격표나 시간표가 보이지 않아요.","학원에서 자료를 등록하지 않았거나 아직 공개되지 않았을 수 있습니다. 학원 관리자 등록·수정 후 공개된 자료를 확인할 수 있습니다."],
 ["학원 정보는 얼마나 최신인가요?","학원 기본정보와 운영자가 등록한 자료는 변경될 수 있습니다. 방문이나 등록 전에는 학원에 직접 연락해 수업 여부와 가격을 확인해 주세요."],
 ["학원을 찜하면 어떤 기능이 있나요?","찜한 학원을 마이페이지에서 모아볼 수 있습니다. 알림 설정에서 해당 학원의 공지사항, 가격표, 시간표 변경 알림을 각각 켜거나 끌 수 있습니다."],
 ["로그인 또는 소셜 로그인이 되지 않아요.","아이디·이메일과 비밀번호를 다시 확인하고 네트워크 연결을 점검해 주세요. Google·카카오 로그인은 해당 계정 인증을 완료한 뒤 앱으로 돌아와야 합니다."],
 ["기존 아이디와 비밀번호로 로그인할 수 있나요?","네. 로그인 화면에서 기존 아이디 또는 이메일과 비밀번호를 입력하면 됩니다. 아이디 로그인에 문제가 있으면 운영자 문의를 이용해 주세요."],
 ["리뷰나 커뮤니티 글은 어떻게 신고하나요?","해당 리뷰나 게시글의 신고 기능을 이용해 사유를 선택해 주세요. 운영자가 신고 내용을 확인하고 운영 기준에 따라 조치합니다."],
 ["학원 관리자 신청은 어떻게 하나요?","학원 상세정보 또는 학원 관리 메뉴에서 신청할 수 있습니다. 공개된 학원 연락처, 공식 블로그·인스타그램 또는 운영자 확인 절차를 통해 학원 관리 권한을 확인합니다."],
 ["회원 탈퇴와 개인정보 문의는 어떻게 하나요?","마이페이지의 내 계정에서 회원 탈퇴를 진행할 수 있습니다. 개인정보 관련 문의는 dlehdrb554@gmail.com 으로 보내 주세요."]
];
export default function Help(){
 const isDark=useColorScheme()==="dark";
 const [expanded,setExpanded]=useState<number|null>(null);
 const s=useMemo(()=>createS(isDark),[isDark]);const router=useRouter();return <SafeAreaView style={s.safe}><View style={s.header}><Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable><Text style={s.title}>도움말</Text></View><ScrollView contentContainerStyle={s.body}>{rows.map(([a,b],index)=><Pressable key={a} style={s.item} onPress={()=>setExpanded(current=>current===index?null:index)}><View style={s.questionRow}><Text style={s.q}>{a}</Text><Text style={s.chevron}>{expanded===index?"−":"＋"}</Text></View>{expanded===index&&<Text style={s.a}>{b}</Text>}</Pressable>)}<Pressable style={s.contact} onPress={()=>Linking.openURL("mailto:dlehdrb554@gmail.com?subject=Balletmate%20%EB%AC%B8%EC%9D%98")}><Text style={s.contactText}>운영자에게 문의하기 · dlehdrb554@gmail.com</Text></Pressable></ScrollView></SafeAreaView>}
const createS = (dark:boolean) => StyleSheet.create(themeStyles({safe:{flex:1,backgroundColor:"#FAF9FC"},header:{padding:16,borderBottomWidth:1,borderColor:"#EAE7F0"},back:{fontSize:12,color:"#7661D8",fontWeight:"800"},title:{fontSize:19,fontWeight:"900",color:"#252238",marginTop:10},body:{padding:16},item:{backgroundColor:"#fff",borderRadius:13,padding:14,marginBottom:10,borderWidth:1,borderColor:"#EAE7F0"},questionRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},q:{fontSize:14,fontWeight:"900",color:"#252238",flex:1},chevron:{fontSize:20,fontWeight:"700",color:"#7661D8"},a:{fontSize:12,color:"#625E70",lineHeight:19,marginTop:7},contact:{padding:14,backgroundColor:"#F3F0FF",borderRadius:12,marginTop:8},contactText:{fontSize:12,fontWeight:"800",color:"#7661D8",textAlign:"center"}},dark));
