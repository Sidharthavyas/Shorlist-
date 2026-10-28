import {createContext,useContext,useEffect,useState} from 'react';
export const AccountContext=createContext<{admin:boolean;name?:string;email?:string}>({admin:['localhost','127.0.0.1'].includes(window.location.hostname)});
export const useAccount=()=>useContext(AccountContext);
export function useAccountSession(){
 const [account,setAccount]=useState({admin:['localhost','127.0.0.1'].includes(window.location.hostname),name:'',email:''});
 useEffect(()=>{if(['localhost','127.0.0.1'].includes(window.location.hostname))return;const control=new AbortController();fetch('/api/auth/session',{signal:control.signal}).then(r=>r.ok?r.json():null).then((result:any)=>{if(result?.data)setAccount(result.data);}).catch(()=>{});return()=>control.abort();},[]);
 return account;
}
