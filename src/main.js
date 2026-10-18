const { app, BrowserWindow, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { setupAssistant } = require('./assistant');
let mainWindow, tray;
function showWindow(){if(!mainWindow)createWindow();else{if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}}
function createTray(){
 const png='iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABBUlEQVR4nM2XwRWDMAiGMVN0CE9O5K0z9eZEnhyiW9hT05QAASRN//e8GMz/CdEQgMGarA/cn+cpjT9uk2lOdXDL2AvSDMLG2zKL8et+mEDEwdK8ZSyBSBDswNvcasyBcBCpp3k5B7eGKoBIcw3EV1okc7y4uDhJVDnIEmjMufvrfuRLowzgTb3WqJy7LIUqA9QkUUoA9rfHcVeyYM4AJwtEKTeA9kvpBsBB/BQgAiJkDVyBCFuEwwG8WUgAn3+z91PCENsys0B4PwgvgTUTGSAqC5Lcu2FPVW1Sj4YEgG/Nqgz0KIXUF5IliIRoNaX/25ZTEBqQ0IOJBNJS2NHMCmI9nA7XCx5YmS5ylKe3AAAAAElFTkSuQmCC';
 try{tray=new Tray(nativeImage.createFromBuffer(Buffer.from(png,'base64')));tray.setToolTip('JARVIS is running');tray.setContextMenu(Menu.buildFromTemplate([{label:'Show JARVIS',click:showWindow},{type:'separator'},{label:'Quit JARVIS',click:()=>{app.isQuitting=true;app.quit();}}]));tray.on('click',showWindow);}catch(e){console.error('Tray unavailable:',e.message);}
}
function createWindow(){
 mainWindow=new BrowserWindow({width:1240,height:900,minWidth:820,minHeight:650,title:'JARVIS',backgroundColor:'#050b16',show:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 mainWindow.loadFile(path.join(__dirname,'index.html'));mainWindow.once('ready-to-show',()=>mainWindow&&mainWindow.show());
 mainWindow.on('close',e=>{if(!app.isQuitting){e.preventDefault();mainWindow.hide();}});mainWindow.on('closed',()=>{mainWindow=null;});
}
app.whenReady().then(async()=>{session.defaultSession.setPermissionRequestHandler((_w,p,cb)=>cb(p==='media'||p==='notifications'));await setupAssistant();createWindow();createTray();}).catch(e=>console.error('JARVIS startup failed:',e));
app.on('activate',showWindow);app.on('before-quit',()=>{app.isQuitting=true;if(tray)tray.destroy();});app.on('window-all-closed',()=>{});
