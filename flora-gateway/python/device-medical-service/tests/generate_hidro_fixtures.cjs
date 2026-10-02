// Rebuild synthetic reference fixtures from the supplied Hidro source tree.
// Usage: node tests/generate_hidro_fixtures.cjs C:/Users/JK/Hidro
// This imports only protocol modules; it never opens hardware or Hidro databases.
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2]);
const ge = require(path.join(root, 'service/ge750/protocol.js'));
const geCmd = require(path.join(root, 'service/ge750/buildCommand.js'));
const checksum = require(path.join(root, 'service/ge750/checksum.js')).computeChecksum;
const dri = require(path.join(root, 'service/gebx50/index.js'));
const bcc = require(path.join(root, 'service/bbraunbcc/protocol.js'));
const result = { provenance: 'Synthetic inputs evaluated by Hidro protocol modules; no patient captures', ge: [], dri: {}, bcc: {} };
function write(buf, at, text) { buf.write(text, at, 'ascii'); }
function geFixture(tag, data) {
  const body = Buffer.concat([Buffer.from(tag),data]);
  const line = Buffer.concat([body, Buffer.from([checksum(Buffer.concat([Buffer.from(':'),body]))])]);
  result.ge.push({wire: Buffer.concat([Buffer.from(':'),line,Buffer.from('\r')]).toString('hex'),
    tag:tag.toUpperCase(), data:data.toString('hex'), expected:tag.toUpperCase()==='VTD' ? ge.parseVTD(line) : ge.parseVTQ(line)});
}
const measured=Buffer.alloc(210,45);
for (const [at,text] of [[0,'0450'],[4,'0650'],[8,'014'],[11,'040'],[14,'021'],[17,'017'],[20,'010'],[23,'003'],
 [26,'0120'],[30,'004'],[33,'020'],[36,'38'],[38,'120'],[43,'0300'],[47,'0480'],[51,'0670'],[64,'050'],[67,'070'],
 [79,'039'],[82,'035'],[89,'001'],[92,'052'],[95,'014'],[98,'020'],[101,'015'],[104,'6'],[105,'001'],[108,'001'],[111,'1'],
 [112,'005'],[115,'004'],[118,'09'],[144,'400'],[147,'350'],[150,'390'],[180,'0100'],[184,'0000'],[188,'0150'],[195,'012'],[198,'030']]) write(measured,at,text);
geFixture('VTd', measured);
geFixture('VTD', measured.subarray(0,26));
const settings=Buffer.alloc(210,45);
for (const [at,text] of [[0,'0500'],[4,'012'],[7,'0019'],[11,'10'],[13,'05'],[15,'040'],[18,'18'],[42,'g'],[46,'040'],[51,'08'],[119,'15'],[125,'25'],[127,'0012'],[136,'10'],[167,'0250']]) write(settings,at,text);
geFixture('VTq',settings);
const short=Buffer.from(settings.subarray(0,54));short[40]='v'.charCodeAt();geFixture('VTq',short);
const fallback=Buffer.from(settings);write(fallback,4,'---');write(fallback,7,'----');geFixture('VTq',fallback);
result.ge_commands=Object.fromEntries(['VTE','VTO12','VTX'].map(cmd=>[cmd,geCmd.buildCmd(cmd).toString('hex')]));
const basic=Buffer.alloc(270);
for(let i=0;i<270;i+=2) basic.writeInt16LE(-32767,i);
for(const [at,n] of [[6,72],[14,14],[22,12100],[24,7600],[26,9100],[28,73],[36,800],[38,400],[40,600],[42,72],
 [78,12100],[80,7600],[82,9100],[92,3650],[100,3710],[124,9800],[126,74],[138,520],[140,0],[142,14],[144,1013],
 [152,3500],[154,4000],[162,100],[164,200],[170,6],[172,150],[174,200],[176,90],[184,14],[186,2100],
 [188,500],[190,1700],[192,4800],[194,4500],[196,3800],[198,650]]) basic.writeInt16LE(n,at);
basic.writeUInt32LE(0,72);basic.writeUInt16LE(1,76);
const record=Buffer.alloc(314);record.writeUInt16LE(314,0);record[3]=9;record.writeUInt32LE(1767225600,6);record[18]=1;record[19]=255;basic.copy(record,44);
result.dri={record:record.toString('hex'),expected:dri.parsePhdbPacket(record)};
result.dri_requests={};
for(const name of ['gebx50','geaisyscs2','ges5']) {
 const protocol=require(path.join(root,`service/${name}/protocol.js`));
 result.dri_requests[name]=protocol.buildAllLevelRequests(5).toString('hex');
}
const text='0,1,INRT,12.5\x1e0,2,INRT,99\x1e0,1,INSOL,Dextrose\x1e0,1,INDCON,5\x1e0,1,INDCONU,mg/mL';
const wire=bcc.buildRequestFrame('1/1/1',text);
result.bcc={wire:wire.toString('hex'),expected:bcc.parseUnescapedFrame(bcc.unescapeFrame(wire.subarray(0,-1))),
 alive:bcc.buildRequestFrame('1/1/1','ADMIN:ALIVE').toString('hex'),poll:bcc.buildRequestFrame('1/1/1','MEM:GET').toString('hex')};
fs.writeFileSync(path.join(__dirname,'fixtures/hidro_reference.json'),JSON.stringify(result,null,2)+'\n');
