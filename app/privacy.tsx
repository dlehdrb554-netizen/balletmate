import React from "react";
import {Alert, Linking, Pressable, StyleSheet, Text, View, useColorScheme} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";

const POLICY_URL="https://dlehdrb554-netizen.github.io/balletmate/privacy-policy.html";

export default function Privacy(){
 const dark=useColorScheme()==="dark";
 const router=useRouter();
 const openPolicy=async()=>{try{await Linking.openURL(POLICY_URL);}catch{Alert.alert("페이지 열기 실패","개인정보처리방침 페이지를 열 수 없습니다. 잠시 후 다시 시도해 주세요.");}};
 return <SafeAreaView style={[s.safe,dark&&s.dark]}>
  <View style={[s.header,dark&&s.darkBorder]}>
   <Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable>
   <Text style={[s.title,dark&&s.lightText]}>개인정보처리방침</Text>
  </View>
  <View style={s.body}>
   <Text style={[s.description,dark&&s.mutedDark]}>발레메이트의 최신 개인정보처리방침은 공식 공개 페이지에서 확인할 수 있습니다.</Text>
   <Pressable style={s.button} onPress={openPolicy}><Text style={s.buttonText}>개인정보처리방침 열기 ↗</Text></Pressable>
   <Text style={[s.note,dark&&s.mutedDark]}>페이지가 열리지 않으면 네트워크 연결을 확인한 뒤 다시 시도해 주세요.</Text>
  </View>
 </SafeAreaView>;
}
const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:"#FAF9FC"},
 dark:{backgroundColor:"#101010"},
 header:{padding:16,borderBottomWidth:1,borderColor:"#EAE7F0"},
 darkBorder:{borderColor:"#383838"},
 back:{fontSize:12,color:"#9B8BE8",fontWeight:"800"},
 title:{fontSize:20,fontWeight:"900",color:"#252238",marginTop:12},
 lightText:{color:"#FFFFFF"},
 body:{padding:20},
 description:{fontSize:14,lineHeight:22,color:"#4E4A5C"},
 button:{marginTop:20,padding:15,borderRadius:12,backgroundColor:"#7661D8",alignItems:"center"},
 buttonText:{fontSize:14,fontWeight:"900",color:"#FFFFFF"},
 note:{fontSize:12,lineHeight:19,color:"#8B879A",marginTop:14},
 mutedDark:{color:"#C2BDCC"}
});
