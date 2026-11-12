import{r as a}from"./index.K-W36a2P.js";/**
 * @license lucide-react v1.14.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=(...t)=>t.filter((e,o,n)=>!!e&&e.trim()!==""&&n.indexOf(e)===o).join(" ").trim();/**
 * @license lucide-react v1.14.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const A=t=>t.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();/**
 * @license lucide-react v1.14.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=t=>t.replace(/^([A-Z])|[\s-_]+(\w)/g,(e,o,n)=>n?n.toUpperCase():o.toLowerCase());/**
 * @license lucide-react v1.14.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=t=>{const e=y(t);return e.charAt(0).toUpperCase()+e.slice(1)};/**
 * @license lucide-react v1.14.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var i={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v1.14.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const L=t=>{for(const e in t)if(e.startsWith("aria-")||e==="role"||e==="title")return!0;return!1},W=a.createContext({}),R=()=>a.useContext(W),S=a.forwardRef(({color:t,size:e,strokeWidth:o,absoluteStrokeWidth:n,className:s="",children:r,iconNode:C,...u},h)=>{const{size:c=24,strokeWidth:l=2,absoluteStrokeWidth:m=!1,color:x="currentColor",className:w=""}=R()??{},k=n??m?Number(o??l)*24/Number(e??c):o??l;return a.createElement("svg",{ref:h,...i,width:e??c??i.width,height:e??c??i.height,stroke:t??x,strokeWidth:k,className:d("lucide",w,s),...!r&&!L(u)&&{"aria-hidden":"true"},...u},[...C.map(([g,b])=>a.createElement(g,b)),...Array.isArray(r)?r:[r]])});/**
 * @license lucide-react v1.14.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=(t,e)=>{const o=a.forwardRef(({className:n,...s},r)=>a.createElement(S,{ref:r,iconNode:e,className:d(`lucide-${A(f(t))}`,`lucide-${t}`,n),...s}));return o.displayName=f(t),o};function p(t,e){if(typeof t=="function")return t(e);t!=null&&(t.current=e)}function v(...t){return e=>{let o=!1;const n=t.map(s=>{const r=p(s,e);return!o&&typeof r=="function"&&(o=!0),r});if(o)return()=>{for(let s=0;s<n.length;s++){const r=n[s];typeof r=="function"?r():p(t[s],null)}}}}function j(...t){return a.useCallback(v(...t),t)}export{v as a,$ as c,j as u};
