import { NextRequest } from "next/server";
import { GET as streamGET } from "../../route";

export async function GET(
  req:NextRequest,
  context:{params:Promise<{token:string;path:string[]}>}
){
  const {token,path}=await context.params;
  const url=new URL(req.url);
  const relativePath=path.map(decodeURIComponent).join("/");
  const query=url.search;
  url.searchParams.set("token",token);
  url.searchParams.set("path",relativePath+query);
  return streamGET(new NextRequest(url,{headers:req.headers}));
}
