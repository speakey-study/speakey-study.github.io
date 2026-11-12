
    'use strict';
    const $ = id => document.getElementById(id);
    const themeMedia=matchMedia('(prefers-color-scheme: dark)');
    function applyTheme(theme){
      const dark=theme==='dark';document.documentElement.dataset.theme=theme;
      $('theme-toggle').setAttribute('aria-pressed',String(dark));
      $('theme-toggle').setAttribute('aria-label',dark?'切换到日间模式':'切换到夜间模式');
      $('theme-toggle').title=dark?'切换到日间模式':'切换到夜间模式';$('theme-label').textContent=dark?'日间':'夜间';
      document.querySelector('meta[name="theme-color"]').content=dark?'#101725':'#f1f4f9';
    }
    applyTheme(document.documentElement.dataset.theme);
    $('theme-toggle').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(theme);try{localStorage.setItem('speakey.theme.v1',theme);}catch{}});
    const onThemeChange=event=>{let saved;try{saved=localStorage.getItem('speakey.theme.v1');}catch{}if(!['light','dark'].includes(saved))applyTheme(event.matches?'dark':'light');};
    if(themeMedia.addEventListener)themeMedia.addEventListener('change',onThemeChange);else if(themeMedia.addListener)themeMedia.addListener(onThemeChange);
    const synth = window.speechSynthesis;
    const hasSpeech = !!synth && typeof window.SpeechSynthesisUtterance === 'function';
    let onlineAudio=null;
    const state = { view:'setup', words:[], items:[], wasReview:false, index:0, first:0, errors:new Set(), phase:'answering', speechToken:0, utterance:null, watchdog:null, audioCleanup:null, audioRun:null };
    let setupRoute='lists',prepSource='paste';
    let preferredPreviewMeaning=false;try{preferredPreviewMeaning=localStorage.getItem('speakey.preview-meaning.v1')==='true';}catch{}$('preview-meaning').checked=preferredPreviewMeaning;
    $('preview-meaning').addEventListener('change',()=>{
      preferredPreviewMeaning=$('preview-meaning').checked;
      try{localStorage.setItem('speakey.preview-meaning.v1',String(preferredPreviewMeaning));}catch{}
      const saved=setupRoute==='lists'?selectedSession():null;
      if(saved)storeDeviceRow('sessions',{...saved,previewMeaning:preferredPreviewMeaning});
    });
    $('practice-preview-meaning').addEventListener('change',()=>{
      state.previewMeaning=$('practice-preview-meaning').checked;preferredPreviewMeaning=state.previewMeaning;$('preview-meaning').checked=state.previewMeaning;
      try{localStorage.setItem('speakey.preview-meaning.v1',String(state.previewMeaning));}catch{}
      syncLearningMeaning();saveDeviceSession();queueAnswerVisibility();
    });
    function syncLearningMeaning(){
      $('practice-preview-meaning').checked=!!state.previewMeaning;
      const cue=$('learning-cue'),entry=state.words[state.index];
      cue.hidden=!state.previewMeaning||state.view!=='practice'||!!state.browse;$('practice').classList.toggle('has-learning-meaning',!cue.hidden);
      if(cue.hidden||!entry){cue.replaceChildren();return;}
      showMeaning(entry,cue);
    }
    const compactScreen=matchMedia('(max-width:600px), (pointer:coarse) and (max-width:1100px)');
    const replayHint=()=>compactScreen.matches?'点“重听”再次播放':'按 Tab 重听';
    let answerViewportFrame=0,answerViewportTimer=0,answerFocusTimer=0;
    function keepAnswerVisible(){
      const viewport=window.visualViewport;
      const active=compactScreen.matches&&state.view==='practice'&&document.activeElement===$('answer');
      const zoomed=viewport&&Math.abs(viewport.scale-1)>0.05;
      // Some browsers resize only the visual viewport. Give the document
      // enough scroll range above their keyboard, without locking page scroll.
      const obscured=active&&!zoomed&&viewport?Math.max(0,innerHeight-viewport.height-viewport.offsetTop):0;
      document.documentElement.style.setProperty('--keyboard-space',obscured+'px');
      if(!active||zoomed)return;
      const top=(viewport?.offsetTop||0)+12;
      const bottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight)-12;
      const input=$('answer').getBoundingClientRect(),button=$('check').getBoundingClientRect();
      const targetTop=input.top-4,targetBottom=button.bottom+4;
      let delta=0;
      if(targetBottom-targetTop>bottom-top)delta=targetTop-top;
      else if(targetBottom>bottom)delta=targetBottom-bottom;
      else if(targetTop<top)delta=targetTop-top;
      if(Math.abs(delta)>1)window.scrollBy({top:delta,left:0,behavior:'auto'});
    }
    function queueAnswerVisibility(){
      cancelAnimationFrame(answerViewportFrame);clearTimeout(answerViewportTimer);
      answerViewportFrame=requestAnimationFrame(keepAnswerVisible);
      answerViewportTimer=setTimeout(keepAnswerVisible,180);
    }
    window.visualViewport?.addEventListener('resize',queueAnswerVisibility);
    window.addEventListener('resize',queueAnswerVisibility);
    $('answer').addEventListener('focus',()=>{queueAnswerVisibility();clearTimeout(answerFocusTimer);answerFocusTimer=setTimeout(keepAnswerVisible,420);});
    $('answer').addEventListener('blur',queueAnswerVisibility);
    // Touching replay must not dismiss and immediately reopen the keyboard.
    for(const id of ['replay','alternate-voice','check'])$(id).addEventListener('pointerdown',event=>{
      if(event.pointerType==='touch'&&document.activeElement===$('answer'))event.preventDefault();
    });
    const normalize = value => value.normalize('NFKC').trim().replace(/[‘’]/g,"'").replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').toLocaleLowerCase('en');
    const hasChinese = value => /\p{Script=Han}/u.test(value);
    function decodeEntities(value){
      const named={nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};
      return value.replace(/&(#x[\da-f]+|#\d+|nbsp|amp|quot|apos|lt|gt);/gi,(entity,key)=>{
        if(key[0]!=='#')return named[key.toLowerCase()];
        const hex=key[1].toLowerCase()==='x';const code=parseInt(key.slice(hex?2:1),hex?16:10);
        return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):entity;
      });
    }
    // Import-only cleanup. Answers intentionally never pass through this function.
    const importLexicon=SpeaKeyAssets.json('import-lexicon');
    const importMemo=new Map();
    function splitJoinedToken(token){
      const lower=token.toLowerCase();
      if(!/^[a-z]{5,48}$/i.test(token)||/^[A-Z]+$/.test(token)||/[a-z][A-Z]/.test(token)||Object.hasOwn(localDictionary,lower)||Object.hasOwn(importLexicon.ranks,lower)||Object.hasOwn(importLexicon.cases,lower))return token;
      const paths=Array.from({length:lower.length+1},()=>[]);paths[0]=[{parts:[],score:0}];
      for(let end=1;end<=lower.length;end++){
        const candidates=[];
        for(let begin=Math.max(0,end-24);begin<end;begin++){
          const part=lower.slice(begin,end),rank=importLexicon.ranks[part];
          if(!rank||rank>30000||(part.length===1&&!['a','i'].includes(part)))continue;
          for(const previous of paths[begin])if(previous.parts.length<6)candidates.push({parts:[...previous.parts,part],score:previous.score+Math.log(rank+50)+2.5});
        }
        paths[end]=candidates.sort((a,b)=>a.score-b.score).slice(0,4);
      }
      const [best,runner]=paths.at(-1);
      if(!best||best.parts.length<2||(runner&&runner.score-best.score<2))return token;
      if(!best.parts.some(part=>importLexicon.ranks[part]<2000)&&!best.parts.every(part=>importLexicon.ranks[part]<10000))return token;
      return best.parts.join(' ');
    }
    function tidyEnglish(value,preserveSpacing=false){
      const memoKey=(preserveSpacing?'exact:':'auto:')+value;
      if(importMemo.has(memoKey))return importMemo.get(memoKey);
      const spaced=preserveSpacing?value:value.replace(/[A-Za-z]+/g,splitJoinedToken);
      const ambiguous=new Set(['may','march','turkey','china','polish','bill','rose','will','mark']);
      let english=spaced.replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g,token=>{
        const lower=token.toLowerCase();
        if(lower==='i')return 'I';
        if(/^[A-Z]{2,}$/.test(token)||/[a-z][A-Z]/.test(token)||ambiguous.has(lower))return token;
        if(Object.hasOwn(importLexicon.cases,lower))return importLexicon.cases[lower];
        if(Object.hasOwn(localDictionary,lower)||Object.hasOwn(importLexicon.ranks,lower))return lower;
        return token;
      });
      const properPhrases=['United States','United Kingdom','New York','New Zealand','Hong Kong','South Korea','North Korea'];
      for(const phrase of properPhrases)english=english.replace(new RegExp('\\b'+phrase+'\\b','gi'),phrase);
      const result={english,spacingChanged:spaced!==value};
      if(importMemo.size>2000)importMemo.clear();importMemo.set(memoKey,result);return result;
    }

    function splitUsage(raw){
      // A plus followed by a usage note is metadata, not part of the phrase.
      // Preserve names and grades such as C++, A+, and unexplained plus signs.
      const match=raw.match(/^(.+?)\s*[+＋]\s*((?:[\u3400-\u9fff]|(?:sb\.?|sth\.?|someone|something|doing|noun|n\.|v-ing|adj\.)(?=$|\s|[,，;；(/])).*)$/i);
      if(!match||!/[A-Za-z]{2}/.test(match[1])||/[+＋]$/.test(match[1]))return {raw,usage:''};
      const parts=match[2].split(/[,，;；]/),usage='后接：'+parts.shift().trim();
      const before=match[1].trim(),extra=parts.join('；').trim();
      return {raw:hasChinese(before)?before+(extra?'；'+extra:''):before+'\t'+extra,usage};
    }
    function parseWords(text){
      const words=[],changes=[];let skipped=0,groups=0;
      function addGroup(parts){
        const members=[];
        for(const original of parts){
          const {raw,usage}=splitUsage(original);
          const value=raw.trim().replace(/\s+/g,' ');if(!value)continue;
          const separator=raw.match(/^([^\t]+)\t(.*)$/u)||value.match(/^(.+?)\s+[|｜]\s*(.*)$/u);
          const split=value.search(/\p{Script=Han}/u);
          // Split the association before separating Chinese. Neither '=' nor a
          // different expression's translation may enter a spoken answer.
          const english=(separator?separator[1]:(split<0?value:value.slice(0,split))).replace(/[\s:：|｜,，;；/／=＝\-–—(（\[【]+$/u,'').replace(/\s+(?:(?:n|v|adj|adv|pron|prep|conj|det|art|vt|vi|int)\.\s*)+$/i,'').trim();
          const chinese=separator?separator[2].trim():(split<0?'':value.slice(split).trim());
          if(!/[a-z]/i.test(english)){
            // Preserve common bilingual input such as 'apple = 苹果'.
            if(split===0&&members.length){const last=members.at(-1);last.chinese=[last.chinese,chinese].filter(Boolean).join('；');last.meaningSource='provided';}
            else skipped++;
            continue;
          }
          const cleaned=tidyEnglish(english,!!separator);
          if(cleaned.spacingChanged)changes.push({before:english,after:cleaned.english});
          const duplicate=members.find(entry=>normalize(entry.english)===normalize(cleaned.english));
          if(duplicate){if(chinese&&!duplicate.chinese){duplicate.chinese=chinese;duplicate.meaningSource='provided';}continue;}
          const inferred=!usage&&window.SpeaKeyPDFCleaner?.relatedEntries({english:cleaned.english,chinese},key=>localDictionary[key]);
          const candidates=inferred||[{english:cleaned.english,chinese,usage}];
          for(const candidate of candidates){
            if(members.some(member=>normalize(member.english)===normalize(candidate.english)))continue;
            members.push({...candidate,english:tidyEnglish(candidate.english,true).english,meaningSource:candidate.chinese?(inferred?'local':'provided'):''});
          }
        }
        if(!members.length)return;
        const groupId=groups++;
        members.forEach((entry,variantIndex)=>{
          // Small independent records keep relationships when only mistakes
          // are copied into a new round, without circular references.
          entry.groupId=groupId;entry.variantIndex=variantIndex;
          entry.related=members.filter(other=>other!==entry).map(({english,chinese,meaningSource,usage})=>({english,chinese,meaningSource,usage}));
          words.push(entry);
        });
      }
      const originalLines=decodeEntities(text).replace(/[\u200b-\u200d\ufeff]/g,'').split(/[\r\n]+/);
      const sourceLines=window.SpeaKeyPDFCleaner?.stripListNumbers(originalLines)||originalLines;
      for(const [i,raw] of sourceLines.entries()){
        if(raw!==originalLines[i])changes.push({before:originalLines[i].trim(),after:raw.trim()});
        const line=raw.trim().replace(/^[-*•·]\s+/u,'').replace(/^(?:[0-9０-９]+[.．、。)）](?![0-9０-９])|[（(][0-9０-９]+[)）])\s*/u,'');
        if(!line)continue;
        if(/[=＝]/u.test(line))addGroup(line.split(/[=＝]+/u));
        else if(hasChinese(line))addGroup([line]);
        else if(/^[^\t]+\t[ ]*$/.test(raw))addGroup([line+'\t']);
        else for(const value of line.split(/[,，;；\t]+/))addGroup([value]);
      }
      return {words,skipped,changes,groups};
    }
    function cleanWordListSeparators(text){
      return text.replace(/(^|\n|[=＝])([^\n=＝\u3400-\u9fff]*?) +[|｜][ \t]*/g,(_,prefix,english)=>prefix+english.trim()+'\t');
    }
    const meaningCache=new Map();const cacheKey='speakey.meanings.v1';const cacheAge=30*24*60*60*1000;
    try{
      const cached=JSON.parse(localStorage.getItem(cacheKey)||'[]');
      if(Array.isArray(cached))for(const item of cached.slice(-200)){
        if(Array.isArray(item)&&typeof item[0]==='string'&&typeof item[1]?.text==='string'&&hasChinese(item[1].text)&&Date.now()-item[1].time<cacheAge)meaningCache.set(item[0],item[1]);
      }
    }catch{}
    function cacheMeaning(english,text){
      const key=normalize(english);meaningCache.delete(key);meaningCache.set(key,{text,time:Date.now()});
      if(meaningCache.size>200)meaningCache.delete(meaningCache.keys().next().value);
      try{localStorage.setItem(cacheKey,JSON.stringify([...meaningCache]));}catch{}
    }
    const localDictionary=SpeaKeyAssets.json('offline-dictionary');
    const meaningJobs=new Map(),meaningFailures=new Map(),meaningActive=new Set();
    const meaningQueue=[];
    function applyKnownMeaning(entry){
      if(entry.chinese)return true;
      const key=normalize(entry.english);
      if(Object.hasOwn(localDictionary,key)){entry.chinese=localDictionary[key];entry.meaningSource='local';return true;}
      const cached=meaningCache.get(key);
      if(cached&&Date.now()-cached.time<cacheAge){entry.chinese=cached.text;entry.meaningSource='online';return true;}
      return false;
    }
    function cancelLookup(){
      for(const job of meaningJobs.values()){job.controller.abort();job.reject(new DOMException('Canceled','AbortError'));}
      meaningJobs.clear();meaningQueue.length=0;meaningActive.clear();
    }
    function pumpMeanings(){
      while(meaningActive.size<2&&meaningQueue.length){
        const job=meaningQueue.shift();
        if(job.controller.signal.aborted)continue;
        meaningActive.add(job);
        const timeout=setTimeout(()=>job.controller.abort(),8000);
        (async()=>{
          const query=new URLSearchParams({q:job.english,langpair:'en|zh-CN'});
          const response=await fetch('https://api.mymemory.translated.net/get?'+query,{signal:job.controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
          if(!response.ok)throw new Error('联网查询暂未成功，请稍后重试。');
          const data=await response.json();
          if(data.quotaFinished||Number(data.responseStatus)===429)throw new Error('在线释义额度暂时用完了，可手动补充中文。');
          const text=typeof data.responseData?.translatedText==='string'?decodeEntities(data.responseData.translatedText).trim():'';
          if(Number(data.responseStatus)!==200||!hasChinese(text)||text.length>2000)throw new Error('暂未查到中文释义，可以重试或在词表中补充中文。');
          if(job.controller.signal.aborted)throw new DOMException('Canceled','AbortError');
          cacheMeaning(job.english,text);meaningFailures.delete(job.key);job.resolve(text);
        })().catch(error=>{
          if(meaningJobs.get(job.key)===job)meaningFailures.set(job.key,{until:Date.now()+30000,error});
          job.reject(error);
        }).finally(()=>{
          clearTimeout(timeout);meaningActive.delete(job);
          if(meaningJobs.get(job.key)===job)meaningJobs.delete(job.key);
          pumpMeanings();
        });
      }
    }
    async function getMeaning(entry,{priority=false,retry=false}={}){
      if(applyKnownMeaning(entry))return entry.chinese;
      const key=normalize(entry.english);
      if(retry)meaningFailures.delete(key);
      const failure=meaningFailures.get(key);
      if(failure&&failure.until>Date.now())throw failure.error;
      if(new TextEncoder().encode(entry.english).length>500)throw new Error('词条过长，请在词表中附上中文释义。');
      if(navigator.onLine===false)throw new Error('本地词库未收录此词条，联网后可补充释义。');
      let job=meaningJobs.get(key);
      if(!job){
        job={key,english:entry.english,controller:new AbortController()};
        job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
        meaningJobs.set(key,job);meaningQueue.push(job);
      }
      if(priority){const index=meaningQueue.indexOf(job);if(index>=0){meaningQueue.splice(index,1);meaningQueue.unshift(job);}}
      pumpMeanings();
      const chinese=await job.promise;
      // User-supplied meanings always take precedence, including repeated words.
      if(!entry.chinese){entry.chinese=chinese;entry.meaningSource='online';}
      if(state.items?.includes(entry)&&state.errors.has(entry.id))persistMistakes();
      return entry.chinese;
    }
    function prepareMeanings(){
      if(state.view!=='practice')return;
      for(const entry of state.words.slice(state.index,state.index+4)){
        if(!applyKnownMeaning(entry))getMeaning(entry,{priority:entry===state.words[state.index]}).catch(()=>{});
      }
    }
    function showMeaning(entry,container,{retry=false,owner=entry}={}){
      const label=document.createElement('span');label.className='meaning-label';label.textContent='中文释义';
      const text=document.createElement('div');text.className='meaning-text';
      const note=document.createElement('p');note.className='meaning-note';
      container.replaceChildren(label,text,note);
      const current=()=>container.isConnected&&container.contains(text)&&state.view==='practice'&&state.words[state.index]===owner;
      const ready=chinese=>{if(current()){holdPracticeHeight();text.textContent=chinese;note.classList.add('ready');note.textContent=entry.meaningSource==='provided'?'来自你的词表':entry.meaningSource==='local'?'本地词库（ECDICT）':'在线释义，仅供参考';}};
      if(applyKnownMeaning(entry)){ready(entry.chinese);return;}
      text.textContent='正在补充中文释义…';note.textContent='你可以继续作答，释义会自动补上。';
      getMeaning(entry,{priority:true,retry}).then(ready).catch(error=>{
        if(!current())return;
        text.textContent='暂未获取到中文释义';note.textContent=error.name==='AbortError'?'在线查询暂未响应，可以重试或手动补充中文。':error.message;
        const button=document.createElement('button');button.type='button';button.className='text-button meaning-retry';button.textContent='重试查询';button.addEventListener('click',()=>showMeaning(entry,container,{retry:true,owner}));container.append(button);
      });
    }

    function holdPracticeHeight(){
      if(state.view!=='practice'||window.scrollY<=0)return;
      const section=$('practice'),outside=document.documentElement.scrollHeight-section.offsetHeight;
      // Keep only the scroll range currently in use, not the tallest past card.
      section.style.minHeight=Math.max(0,window.scrollY+innerHeight-outside,parseFloat(section.style.minHeight)||0)+'px';
    }
    function syncSelfCheck(){
      const ready=state.view==='practice'&&state.phase==='correct';
      $('empty-answer-hint').hidden=ready;$('meaning-mistake').hidden=!ready;
      $('meaning-mistake').disabled=!!state.meaningMarked&&!canUndoMeaning();
      $('meaning-mistake-label').textContent=state.meaningMarked?(canUndoMeaning()?'撤销本次标错':'已记为错词'):'意思记错了';
      $('meaning-mistake-shortcut').hidden=!!state.meaningMarked;syncSubmissionUndo();
    }
    function canUndoMeaning(){
      const change=state.meaningChanges?.get(state.index);
      return !!change&&change.entry===state.words[state.index]&&change.revision===change.entry.revision;
    }
    function undoMeaning(){
      if(!canUndoMeaning())return;
      const change=state.meaningChanges.get(state.index),entry=change.entry;
      state.first+=Number(change.firstCorrect)-Number(entry.firstCorrect);
      for(const key of ['firstCorrect','needsReview','streak','mastered'])entry[key]=change[key];
      entry.revision++;if(!change.wasError)state.errors.delete(entry.id);
      if(!change.hadPending){
        const from=state.browse?(state.browse.view==='result'?state.browse.index:state.browse.index+1):state.index+1;
        const pending=state.words.indexOf(entry,from);if(pending>=0)state.words.splice(pending,1);
      }
      state.markedVisits.delete(state.index);state.meaningChanges.delete(state.index);state.meaningMarked=false;
      showFeedback(entry,'已撤销本次标错',{success:true,help:entry.needsReview?'原有错词复习保留。':'本词恢复为已通过。'});
      $('review-status').hidden=!entry.needsReview;if(entry.needsReview)setReviewStatus('待复习',entry.streak);
      $('answer').classList.add('correct');updateProgress();syncSelfCheck();persistMistakes();
    }
    function markMeaningWrong(options={}){state.submissionUndo=null;syncSubmissionUndo();try{return markMeaningWrongCore(options);}finally{saveDeviceSession();}}
    function markMeaningWrongCore({undo=false}={}){
      if(state.view!=='practice'||state.phase!=='correct')return;
      if(state.meaningMarked){if(undo)undoMeaning();return;}
      const entry=state.words[state.index];
      const cursor=state.browse?Math.min(state.browse.index,state.words.length-1):state.index;
      const before={entry,revision:entry.revision+1,firstCorrect:entry.firstCorrect,needsReview:entry.needsReview,streak:entry.streak,mastered:entry.mastered,wasError:state.errors.has(entry.id),hadPending:state.words.slice(cursor+1).includes(entry)};
      entry.revision++;state.meaningChanges.set(state.index,before);state.meaningMarked=true;state.markedVisits.add(state.index);
      if(entry.firstCorrect){state.first--;entry.firstCorrect=false;}
      entry.needsReview=true;entry.streak=0;entry.mastered=false;state.errors.add(entry.id);
      scheduleReview(entry);updateProgress();$('review-status').hidden=false;setReviewStatus('待复习',0);
      $('answer').classList.remove('correct');$('speech-status').textContent='已记为错词';
      showFeedback(entry,'意思需要再记一次',{help:'已加入错词表，之后还需连续两次复习答对。'});
      $('check').textContent=state.browse?'返回当前进度 ↵':'下一词 ↵';syncSelfCheck();persistMistakes();$('check').focus({preventScroll:true});
    }
    $('meaning-mistake').addEventListener('click',()=>markMeaningWrong({undo:true}));
    function markLastMeaningWrong(){
      if(state.phase!=='correct'&&!state.browse){if(state.index<=0)return;previousWord();}
      markMeaningWrong();
    }
    document.addEventListener('keydown',event=>{
      const single=event.key==='ArrowDown'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey;
      const legacy=event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.altKey;
      const target=event.target;
      if(event.isComposing||event.keyCode===229)return;
      if((single||legacy)&&state.view==='practice'&&!target.isContentEditable&&!target.matches('textarea,select')&&(!target.matches('input')||target.id==='answer')){
        event.preventDefault();event.stopImmediatePropagation();
        if(!event.repeat&&!event.isComposing&&event.keyCode!==229)markLastMeaningWrong();
      }
    },true);
    function showFeedback(entry,message,{success=false,spelling=false,help='',neutral=false}={}){
      state.feedback={entry,message,options:{success,spelling,help,neutral}};
      holdPracticeHeight();const feedback=$('feedback');feedback.className=neutral?'feedback neutral':success?'feedback success':'feedback';feedback.replaceChildren();feedback.hidden=false;
      const label=document.createElement('span');label.textContent=message;
      if(spelling){const correction=document.createElement('div');correction.className='correction-answer';label.className='correction-label';const word=document.createElement('strong');word.className='spelling';word.textContent=entry.english;correction.append(label,word);feedback.append(correction);}else feedback.append(label);
      if(help){const detail=document.createElement('p');detail.textContent=help;detail.className='feedback-help';feedback.append(detail);}
      const meaning=document.createElement('div');meaning.className='meaning';feedback.append(meaning);showMeaning(entry,meaning);
      if(entry.usage){const note=document.createElement('div');note.className='usage-note';note.textContent=entry.usage;feedback.append(note);}
    }
    function setInfo(id,parts){
      const target=$(id);target.classList.add('info-stack');target.replaceChildren(...parts.filter(Boolean).map(text=>{const span=document.createElement('span');span.textContent=text;span.title=text;return span;}));queueAnswerVisibility();
    }
    function setReviewStatus(label,streak){setInfo('review-status',[label,'连续答对 '+streak+' / 2']);}
    function notice(message) { holdPracticeHeight();const target=$(state.view==='recognition'?'recognition-notice':'audio-notice');target.textContent=message;target.hidden=!message;queueAnswerVisibility(); }
    // A derived expression is an import role, never guessed from its spelling.
    const derivativeChoice={keys:new Set()};
    const relatedChoice={include:true};
    // One preference controls both kinds of optional expression. Preserve any
    // previous opt-out when migrating the two old, independent preferences.
    const relatedPreferenceKey='speakey.include-associated.v1';
    try{
      const saved=localStorage.getItem(relatedPreferenceKey);
      relatedChoice.include=saved===null
        ?localStorage.getItem('speakey.include-derivatives.v1')!=='false'&&localStorage.getItem('speakey.include-related.v1')!=='false'
        :saved!=='false';
      if(saved===null)localStorage.setItem(relatedPreferenceKey,String(relatedChoice.include));
    }catch{}
    function isOptionalDerivative(entry,keys=derivativeChoice.keys){
      return keys.has(normalize(entry.english));
    }
    function practiceWords(words=parseWords($('word-list').value).words,keys=derivativeChoice.keys){
      return words.filter(entry=>relatedChoice.include||(!isOptionalDerivative(entry,keys)&&!entry.variantIndex));
    }
    function setRelatedPreference(include){
      relatedChoice.include=!!include;
      try{localStorage.setItem(relatedPreferenceKey,String(relatedChoice.include));}catch{}
      updateCount();window.dispatchEvent(new Event('speakey-related-change'));
    }
    function renderRelatedChoice(words,prefix=''){
      $(prefix+'include-related').checked=relatedChoice.include;
      $(prefix+'related-note').textContent=relatedChoice.include?'包含派生词和同义替换词':'只听写主词，完整词表保留';
    }
    function derivativeKeys(mainLines,derivedLines){
      const primary=new Set(parseWords(mainLines.join('\n')).words.map(entry=>normalize(entry.english)));
      return new Set(parseWords(derivedLines.join('\n')).words.map(entry=>normalize(entry.english)).filter(key=>!primary.has(key)));
    }
    function renderPracticeChoice(words){
      renderRelatedChoice(words);
      const present=new Set(words.map(entry=>normalize(entry.english)));
      derivativeChoice.keys=new Set([...derivativeChoice.keys].filter(key=>present.has(key)));
    }
    function acceptPDFDerivatives(incomingWords,keys,replace){
      const current=parseWords($('word-list').value).words;
      const existingPrimary=new Set(replace?[]:current.filter(entry=>!isOptionalDerivative(entry)).map(entry=>normalize(entry.english)));
      const incomingPrimary=new Set(incomingWords.filter(entry=>!isOptionalDerivative(entry,keys)).map(entry=>normalize(entry.english)));
      derivativeChoice.keys=new Set([...(replace?[]:derivativeChoice.keys),...keys].filter(key=>!existingPrimary.has(key)&&!incomingPrimary.has(key)));
    }
    $('include-related').addEventListener('change',event=>setRelatedPreference(event.target.checked));
    $('word-list').addEventListener('beforeinput',event=>{
      const field=event.currentTarget;
      if(event.inputType?.startsWith('insert')&&field.value&&field.selectionStart===0&&field.selectionEnd===field.value.length)derivativeChoice.keys.clear();
    });

    function updateCount(){
      const cleanedList=cleanWordListSeparators($('word-list').value);
      if(cleanedList!==$('word-list').value)$('word-list').value=cleanedList;
      const parsed=parseWords($('word-list').value);renderPracticeChoice(parsed.words);
      const words=parsed.words,groups=new Set(words.map(entry=>entry.groupId)).size,{skipped,changes}=parsed;
      $('word-count').textContent=words.length;$('start').disabled=!words.length;
      $('group-count').hidden=groups===words.length;$('group-count').textContent=groups+' 组';
      $('import-summary').textContent=words.length?'已识别 '+groups+' 组、'+words.length+' 个听写项':'';
      $('import-warning').hidden=!skipped;$('import-warning').textContent=skipped?'已忽略 '+skipped+' 项未含英文的内容。请将中英文放在同一行。':'';
      $('import-changes').hidden=!changes.length;$('changes-summary').textContent='查看已整理的 '+changes.length+' 处词条';
      saveEditorDraft();
      $('changes-list').replaceChildren(...changes.map(change=>{const li=document.createElement('li'),before=document.createElement('del'),after=document.createElement('strong');before.textContent=change.before;after.textContent=change.after;li.append(before,document.createTextNode(' → '),after);return li;}));
    }
    function setView(view){state.view=view;['setup','practice','result','recognition'].forEach(name=>{if($(name))$(name).hidden=name!==view;});if(view!=='setup'){const label=state.returnRoute==='review'?'返回错词复习':'返回词表';$('back').textContent=label;$('edit').textContent=label;}}
    // Each cached recording owns its media element. Stopping playback never resets
    // another word's source, so delayed load/error events cannot cross words.
    const audioRecords=new Map();const audioFailures=new Map();
    let audioWarmTimer=null;
    const recordingKey=(entry,provider,accent)=>provider+'|'+accent+'|'+normalize(entry.english);
    const deviceRoutes=new Map(),deviceRouteKey='speakey.device-routes.v1';
    try{const saved=JSON.parse(localStorage.getItem(deviceRouteKey)||'[]');if(Array.isArray(saved))for(const pair of saved.slice(-200)){if(Array.isArray(pair)&&typeof pair[0]==='string'&&Number.isFinite(pair[1])&&pair[1]>Date.now())deviceRoutes.set(pair[0],pair[1]);}}catch{}
    const deviceKey=(entry,accent)=>accent+'|'+normalize(entry.english);
    function rememberDevice(entry,accent,usable){
      const key=deviceKey(entry,accent);deviceRoutes.delete(key);
      if(usable)deviceRoutes.set(key,Date.now()+6*60*60*1000);
      while(deviceRoutes.size>200)deviceRoutes.delete(deviceRoutes.keys().next().value);
      try{localStorage.setItem(deviceRouteKey,JSON.stringify([...deviceRoutes]));}catch{}
    }
    const prefersDevice=(entry,accent)=>(deviceRoutes.get(deviceKey(entry,accent))||0)>Date.now();
    const recordingFailed=(entry,provider,accent)=>(audioFailures.get(recordingKey(entry,provider,accent))||0)>Date.now();
    function youdaoAccents(entry,accent,force=false){
      const other=accent==='en-GB'?'en-US':'en-GB';
      const failed=voice=>(audioFailures.get(recordingKey(entry,'youdao',voice))||0)>Date.now();
      return !force&&failed(accent)&&!failed(other)?[other,accent]:[accent,other];
    }
    function updateListeningControls(){$('alternate-voice').disabled=state.phase==='correct'&&!state.browse;}
    $('alternate-voice').addEventListener('click',()=>{sayCurrent({alternate:true});warmAudio();if(!state.readingCorrection&&!state.browse)$('answer').focus({preventScroll:true});});
    function stopSpeech(){
      state.speechToken++;clearTimeout(state.watchdog);state.watchdog=null;clearTimeout(audioWarmTimer);
      state.audioCleanup?.();state.audioCleanup=null;state.audioRun=null;
      if(state.utterance){state.utterance.onstart=state.utterance.onend=state.utterance.onerror=null;if(hasSpeech)synth.cancel();state.utterance=null;}
      if(onlineAudio){onlineAudio.pause();}
      $('replay').classList.remove('speaking');$('recognition-replay')?.classList.remove('speaking');
    }
    function englishVoices(){
      if(!hasSpeech)return [];
      try{return synth.getVoices().filter(voice=>/^en(?:[-_]|$)/i.test(voice.lang));}catch{return [];}
    }
    function updateVoiceHint(){
      $('voice-source-hint').textContent=$('voice-source').value==='online'?'有道优先。所选口音不可用时尝试有道另一口音，仍不可用则优先使用设备英语；已成功使用设备语音的词会记住选择。':englishVoices().some(voice=>voice.localService)?'优先使用设备中已安装的英语声音，支持离线练习。':'英语声音可能仍在加载；不可用时自动尝试在线英语发音。';
    }
    function saveListeningSettings(){
      try{localStorage.setItem('speakey.listening.v1',JSON.stringify({source:$('voice-source').value,accent:$('accent').value,rate:Number($('rate').value)}));}catch{}
    }
    try{
      const saved=JSON.parse(localStorage.getItem('speakey.listening.v1')||'null');
      if(['online','device'].includes(saved?.source))$('voice-source').value=saved.source;
      if(['en-US','en-GB'].includes(saved?.accent))$('accent').value=saved.accent;
      if(typeof saved?.rate==='number'&&saved.rate>=0.5&&saved.rate<=1.2){$('rate').value=saved.rate;$('rate-value').textContent=saved.rate.toFixed(2)+'×';}
    }catch{}
    $('voice-source').addEventListener('change',()=>{updateVoiceHint();saveListeningSettings();});
    $('accent').addEventListener('change',saveListeningSettings);
    $('rate').addEventListener('change',saveListeningSettings);
    if(hasSpeech)synth.addEventListener?.('voiceschanged',updateVoiceHint);
    updateVoiceHint();
    function audioURL(entry,provider,accent){
      if(provider==='baidu')return 'https://fanyi.baidu.com/gettts?'+new URLSearchParams({lan:'en',text:entry.english,spd:'3',source:'web'});
      return 'https://dict.youdao.com/dictvoice?audio='+encodeURIComponent(entry.english)+'&le=en&type='+(accent==='en-GB'?'1':'2');
    }
    function releaseRecording(record){
      if(record.audio===onlineAudio)return;
      record.audio.oncanplay=record.audio.onerror=null;record.audio.pause();
      record.audio.removeAttribute('src');record.audio.load();
    }
    function recording(entry,provider,accent,fresh=false){
      const key=recordingKey(entry,provider,accent);
      let record=audioRecords.get(key);
      if(record&&(fresh||record.failed)){audioRecords.delete(key);releaseRecording(record);record=null;}
      if(record)return record;
      const audio=new Audio();audio.preload='auto';
      record={key,audio,ready:false,failed:false};
      audio.oncanplay=()=>{record.ready=true;record.failed=false;audioFailures.delete(key);};audio.onerror=()=>{record.failed=true;audioFailures.set(key,Date.now()+30000);};
      audio.src=audioURL(entry,provider,accent);audioRecords.set(key,record);
      audio.load();
      // Keep a small rolling window, not an entire long word list in memory.
      for(const [oldKey,oldRecord] of audioRecords){
        if(audioRecords.size<=12)break;
        if(oldRecord.audio!==onlineAudio){audioRecords.delete(oldKey);releaseRecording(oldRecord);}
      }
      return record;
    }
    function warmAudio(){
      clearTimeout(audioWarmTimer);
      if(state.view!=='practice'||state.browse||navigator.onLine===false||($('voice-source').value==='device'&&englishVoices().some(voice=>voice.localService)))return;
      const index=state.index,words=state.words,accent=$('accent').value;
      // Foreground playback always starts first. Only warm the next two words.
      audioWarmTimer=setTimeout(()=>{
        if(state.view!=='practice'||state.words!==words||state.index!==index)return;
        for(const entry of words.slice(index+1,index+3)){
          if(prefersDevice(entry,accent)&&englishVoices().length)continue;
          for(const voiceAccent of youdaoAccents(entry,accent))if(!recordingFailed(entry,'youdao',voiceAccent))recording(entry,'youdao',voiceAccent);
        }
      },150);
    }
    function waitForVoices(){
      if(!hasSpeech||englishVoices().length)return Promise.resolve();
      return new Promise(resolve=>{
        let timer;const finish=()=>{clearTimeout(timer);synth.removeEventListener?.('voiceschanged',changed);resolve();};
        const changed=()=>{if(englishVoices().length)finish();};
        synth.addEventListener?.('voiceschanged',changed);timer=setTimeout(finish,700);changed();
      });
    }
    function sayCurrent({alternate=false}={}){
      if(!['practice','recognition'].includes(state.view)||(state.view==='practice'&&state.phase==='correct'&&!state.browse)||!state.words[state.index])return;
      const speechId=state.view==='recognition'?'recognition-speech':'speech-status',replay=state.view==='recognition'?$('recognition-replay'):$('replay');
      const entry=state.words[state.index];
      // Repeated Tab while loading must not abort and restart the same download.
      if(!alternate&&state.audioRun?.entry===entry&&state.audioRun.status==='loading')return;
      const accent=$('accent').value;
      const previous=state.audioRun;const forceNetwork=alternate||previous?.status==='failed';
      const preferredAccent=alternate?((previous?.lastAccent||accent)==='en-US'?'en-GB':'en-US'):previous?.entry===entry?previous.preferredAccent:null;
      stopSpeech();notice('');
      const run={token:state.speechToken,entry,status:'loading',serial:0,preferredAccent,lastProvider:null,lastAccent:null,networkDeadline:Date.now()+1500};state.audioRun=run;
      const fastDevice=englishVoices().some(voice=>voice.localService);
      const voicesReady=devicesReady();
      const current=()=>run.token===state.speechToken&&['practice','recognition'].includes(state.view)&&(state.view==='recognition'||state.phase!=='correct'||state.browse)&&state.words[state.index]===entry;
      const clearAttempt=()=>{clearTimeout(state.watchdog);state.watchdog=null;state.audioCleanup?.();state.audioCleanup=null;};
      const completed=label=>{if(!current())return;clearAttempt();run.status='done';replay.classList.remove('speaking');setInfo(speechId,[label]);queueAnswerVisibility();};
      const permissionNeeded=()=>{
        if(!current())return;clearAttempt();run.status='blocked';if(onlineAudio)onlineAudio.pause();
        replay.classList.remove('speaking');$(speechId).textContent='点击喇叭开启声音';
        notice('浏览器暂未允许播放声音，请点击喇叭后继续听写。');
      };
      const failed=()=>{
        if(!current())return;clearAttempt();run.status='failed';replay.classList.remove('speaking');
        $(speechId).textContent=compactScreen.matches?'暂未播放，点“重听”再试':'暂未播放，点击喇叭或按 Tab 再试';
        notice(navigator.onLine===false?'当前处于离线状态，且没有可用的设备英语声音。联网后点击重听即可。':'多个英语声音都未能播放，请点击喇叭重试；也可返回设置切换语音来源。');queueAnswerVisibility();
      };
      async function devicesReady(){
        await waitForVoices();
        const voices=englishVoices();
        const score=voice=>(voice.localService?4:0)+(voice.lang.replace(/_/g,'-').toLowerCase()===accent.toLowerCase()?2:0);
        return voices.sort((a,b)=>score(b)-score(a)).filter(voice=>navigator.onLine!==false||voice.localService).slice(0,3);
      }
      const attemptDevice=(voice,next)=>{
        if(!current())return;clearAttempt();run.status='loading';
        const serial=++run.serial;const active=()=>current()&&serial===run.serial;
        const utterance=new SpeechSynthesisUtterance(entry.english);state.utterance=utterance;
        utterance.voice=voice;utterance.lang=voice.lang.replace(/_/g,'-');utterance.rate=Number($('rate').value);
        const label='设备英语（'+voice.name+'）';
        let settled=false;
        const advance=()=>{if(!active()||settled)return;settled=true;clearAttempt();rememberDevice(entry,accent,false);synth.cancel();state.utterance=null;next();};
        state.audioCleanup=()=>{utterance.onstart=utterance.onend=utterance.onerror=null;};
        $(speechId).textContent='正在准备英语声音…';
        state.watchdog=setTimeout(advance,3500);
        utterance.onstart=()=>{if(!active())return;clearTimeout(state.watchdog);run.status='playing';run.lastProvider='device';run.lastAccent=voice.lang;rememberDevice(entry,accent,true);notice('');setInfo(speechId,['正在朗读',label]);replay.classList.add('speaking');};
        utterance.onend=()=>{if(!active()||settled)return;settled=true;state.utterance=null;completed(label);};
        utterance.onerror=event=>{if(!active()||settled)return;if(event.error==='not-allowed'){settled=true;permissionNeeded();}else advance();};
        try{synth.resume();synth.speak(utterance);}catch{advance();}
      };
      const attemptOnline=(provider,next,fresh=false,voiceAccent=accent)=>{
        if(!current())return;clearAttempt();run.status='loading';
        const serial=++run.serial;const active=()=>current()&&serial===run.serial;
        const record=recording(entry,provider,voiceAccent,fresh);const audio=record.audio;onlineAudio=audio;
        const label=provider==='baidu'?'百度备用英语':(voiceAccent==='en-GB'?'有道英音':'有道美音')+(voiceAccent!==accent?'（备用口音）':'');
        let settled=false,started=false;
        const startWait=()=>provider==='youdao'&&fastDevice?Math.max(0,Math.min(1500,run.networkDeadline-Date.now())):4000;
        const advance=()=>{
          if(!active()||settled)return;settled=true;record.failed=true;clearAttempt();audio.pause();
          audioFailures.set(record.key,Date.now()+30000);next();
        };
        const playing=()=>{if(!active()||settled)return;started=true;clearTimeout(state.watchdog);audioFailures.delete(record.key);rememberDevice(entry,accent,false);run.status='playing';run.lastProvider=provider;run.lastAccent=voiceAccent;notice('');setInfo(speechId,['正在朗读',label]);replay.classList.add('speaking');};
        const ended=()=>{if(!active()||settled)return;settled=true;completed(label);};
        const waiting=()=>{if(!active()||settled)return;clearTimeout(state.watchdog);state.watchdog=setTimeout(advance,started?4000:startWait());};
        audio.addEventListener('playing',playing);audio.addEventListener('ended',ended);audio.addEventListener('error',advance);audio.addEventListener('waiting',waiting);
        state.audioCleanup=()=>{audio.removeEventListener('playing',playing);audio.removeEventListener('ended',ended);audio.removeEventListener('error',advance);audio.removeEventListener('waiting',waiting);};
        $(speechId).textContent='正在加载英语发音…';audio.playbackRate=Number($('rate').value);audio.preservesPitch=true;
        try{audio.currentTime=0;}catch{}
        state.watchdog=setTimeout(advance,startWait());
        try{
          const promise=audio.play();
          promise?.catch(error=>{
            if(!active()||settled)return;
            if(error.name==='NotAllowedError'){settled=true;permissionNeeded();}
            else advance();
          });
        }catch{advance();}
      };
      const tryDevices=async next=>{
        const voices=await voicesReady;if(!current())return;
        let index=0;const more=()=>{if(!current())return;const voice=voices[index++];if(voice)attemptDevice(voice,more);else next();};more();
      };
      const tryYoudao=next=>{
        if(navigator.onLine===false){next();return;}
        const accents=youdaoAccents(entry,run.preferredAccent||accent,!!run.preferredAccent);
        let index=0;const more=()=>{
          if(!current())return;
          const voiceAccent=accents[index++];if(!voiceAccent){next();return;}
          if(!forceNetwork&&recordingFailed(entry,'youdao',voiceAccent)){more();return;}
          attemptOnline('youdao',more,forceNetwork,voiceAccent);
        };more();
      };
      const tryBaidu=()=>{
        if(navigator.onLine===false||(!forceNetwork&&recordingFailed(entry,'baidu',accent))){failed();return;}
        attemptOnline('baidu',failed,forceNetwork);
      };
      const directDevice=!run.preferredAccent&&($('voice-source').value==='device'||prefersDevice(entry,accent));
      if(directDevice||navigator.onLine===false)tryDevices(()=>{rememberDevice(entry,accent,false);tryYoudao(tryBaidu);});
      else tryYoudao(()=>tryDevices(tryBaidu));
      warmAudio();
    }


    function updateProgress(){
      const passed=state.items.filter(entry=>entry.mastered).length;
      $('word-index').textContent=`已通过 ${passed} / ${state.items.length}`;
      const progress=Math.round(passed/state.items.length*100);
      $('progress').setAttribute('aria-valuenow',progress);$('progress-fill').style.width=progress+'%';
    }
    // One future occurrence per difficult word. A correction is practice, not a review pass.
    function scheduleReview(entry){
      const cursor=state.browse?Math.min(state.browse.index,state.words.length-1):state.index;
      if(state.words.slice(cursor+1).includes(entry))return;
      const slots=[];
      for(let at=cursor+1;at<=state.words.length;at++){
        if(at===cursor+1&&at<state.words.length)continue;
        const left=state.words[at-1],right=state.words[at];
        if(right&&left.groupId!==undefined&&left.groupId===right.groupId)continue;
        slots.push(at);
      }
      // Insert at group boundaries so a review never interrupts a new family.
      const options=slots.slice(0,5);const at=options.length?options[Math.floor(Math.random()*options.length)]:state.words.length;
      state.words.splice(at,0,entry);
    }
    function renderWord(){
      state.submissionUndo=null;$('submission-status').textContent='';
      $('history-answer').hidden=true;$('history-answer').textContent='';$('answer').hidden=false;
      syncPrevious();state.feedback=null;holdPracticeHeight();state.meaningMarked=false;state.readingCorrection=false;document.getElementById('practice').classList.remove('reading-correction');

      const entry=state.words[state.index];entry.revision++;state.wasReview=entry.seen;entry.seen=true;
      state.phase='answering';syncSelfCheck();updateProgress();updateListeningControls();
      $('review-status').hidden=!state.wasReview;
      if(state.wasReview)setReviewStatus('复习',entry.streak);else $('review-status').replaceChildren();
      $('answer').value='';$('answer').readOnly=false;$('answer').classList.remove('correct');$('answer').setAttribute('aria-invalid','false');
      $('feedback').hidden=true;$('feedback').replaceChildren();$('feedback').className='feedback';
      $('check').disabled=false;$('check').textContent='检查拼写 ↵';$('replay').disabled=false;$('practice-title').textContent='写下你听到的单词';
      if(!state.readingCorrection&&!state.browse){$('answer').focus({preventScroll:true});queueAnswerVisibility();}syncLearningMeaning();sayCurrent();prepareMeanings();warmAudio();
    }
    function start(){if(!parseWords($('word-list').value).words.length||!savePreparedList())return;openPracticeSetup([editorListId]);}
    function restartSession(){startSession(state.savedReviewBase?.length?state.savedReviewBase:state.items,state.libraryContext);}
    function roundMistakes(){
      const seen=new Set();
      return Array.from(state.errors,id=>state.items[id]).filter(entry=>{const key=normalize(entry.english);if(seen.has(key))return false;seen.add(key);return true;});
    }
    function retryMistakes(){startSession(roundMistakes());}
    function startSession(words,context=null){
      if(!words.length)return;
      saveDeviceSession();saveEditorDraft();persistMistakes();state.recognition=null;state.returnRoute=context?.returnRoute||(setupRoute==='review'?'review':'lists');state.libraryContext=context||{listIds:[],label:'错词复习'};state.roundId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);state.roundCreated=Date.now();state.roundComplete=false;
      cancelLookup();stopSpeech();state.previewMeaning=$('preview-meaning').checked;
      $('practice').style.minHeight='';
      state.items=words.map((entry,id)=>({...entry,id,seen:false,needsReview:false,streak:0,mastered:false,firstCorrect:false,revision:0}));
      const groups=new Map();
      for(const entry of state.items){const key=entry.groupId===undefined?'single-'+entry.id:entry.groupId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
      const blocks=[...groups.values()].map(group=>group.sort((a,b)=>(a.variantIndex||0)-(b.variantIndex||0)));
      if(document.querySelector('input[name="order"]:checked').value==='random'){
        for(let i=blocks.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[blocks[i],blocks[j]]=[blocks[j],blocks[i]];}
      }
      state.words=blocks.flat();
      state.browse=null;state.markedVisits=new Set();state.meaningChanges=new Map();state.feedback=null;state.index=0;state.first=0;state.errors=new Set();setView('practice');renderWord();saveDeviceSession();
    }
    function checkAnswer(){
      const scoring=state.view==='practice'&&!state.browse&&!state.readingCorrection&&state.phase!=='correct';
      const saved=scoring?captureSubmission():null;
      try{const result=checkAnswerCore();if(saved){saved.expectedRevision=state.items[saved.entryId].revision;state.submissionUndo=saved;}syncSubmissionUndo();return result;}finally{saveDeviceSession();}
    }
    function checkAnswerCore(){
      if(state.view!=='practice')return;
      if(state.browse){resumeProgress();return;}
      if(state.readingCorrection){beginRetype();return;}
      if(state.phase==='correct'){state.index++;if(state.index>=state.words.length)finish();else renderWord();return;}
      const entry=state.words[state.index],answer=normalize($('answer').value);entry.revision++;
      if(answer!==normalize(entry.english)){
        state.errors.add(entry.id);entry.needsReview=true;entry.streak=0;entry.mastered=false;state.phase='retry';syncSelfCheck();updateProgress();
        $('review-status').hidden=false;setReviewStatus('待复习',0);
        $('answer').setAttribute('aria-invalid','true');$('answer').value='';
        const relatedAnswer=entry.related?.some(other=>normalize(other.english)===answer);
        showFeedback(entry,'正确拼写',{spelling:true,help:relatedAnswer?'你写的是本组关联表达，请拼写刚才听到的内容。开始重拼后隐藏答案。':!answer?(compactScreen.matches?'留空已按不会处理。误触可点“撤销提交”。':'留空已按不会处理。误按回车可点“撤销提交”，或按 Esc。'):'开始重拼后隐藏答案；订正后还需两次复习答对。'});
        $('check').textContent='检查订正 ↵';$('practice-title').textContent='重新拼写';
        if(compactScreen.matches)readCorrection();else{$('answer').focus({preventScroll:true});queueAnswerVisibility();}
        persistMistakes();sayCurrent();return;
      }
      const correction=state.phase==='retry';let message='拼写正确',detail='';
      if(correction){scheduleReview(entry);message='订正正确';detail='稍后随机复习';}
      else if(state.wasReview){
        entry.streak++;
        if(entry.streak>=2){entry.mastered=true;message='连续两次答对';detail='本词已通过';}
        else{scheduleReview(entry);message='复习答对';detail='还需再独立答对一次';}
        setReviewStatus('复习',entry.streak);
      }else{state.first++;entry.firstCorrect=true;entry.mastered=true;}
      state.phase='correct';syncSelfCheck();stopSpeech();updateProgress();updateListeningControls();$('replay').disabled=true;$('speech-status').textContent='拼写正确';
      $('answer').readOnly=true;$('answer').setAttribute('aria-invalid','false');$('answer').classList.add('correct');
      showFeedback(entry,message,{success:true,help:detail});$('practice-title').textContent=message;
      $('check').textContent=state.index+1===state.words.length?'查看结果 ↵':'下一词 ↵';$('check').focus({preventScroll:true});
      prepareMeanings();warmAudio();
    }
    function finish(){
      state.roundComplete=true;persistMistakes();
      cancelLookup();stopSpeech();notice('');setView('result');$('test-without-meaning').hidden=!state.previewMeaning;syncPrevious();
      $('total-result').textContent=state.items.length;$('accuracy-result').textContent=Math.round(state.first/state.items.length*100)+'%';
      $('retry-result').textContent=state.errors.size;$('review').hidden=!state.errors.size;
      const missedCount=roundMistakes().length;
      $('retry-mistakes').hidden=!missedCount;const retryLabel=document.createElement('span'),retryCount=document.createElement('span');retryLabel.textContent='只练本轮错词';retryCount.className='button-count';retryCount.textContent=missedCount+' 词';$('retry-mistakes').replaceChildren(retryLabel,retryCount);
      $('restart').className=missedCount||state.previewMeaning?'secondary':'primary';
      $('review-list').replaceChildren(...roundMistakes().map(entry=>{
        const li=document.createElement('li');li.textContent=entry.english;
        if(entry.chinese){const meaning=document.createElement('span');meaning.className='review-meaning';meaning.textContent=entry.chinese;li.append(meaning);}
        if(entry.usage){const usage=document.createElement('span');usage.className='review-meaning';usage.textContent=entry.usage;li.append(usage);}
        const practiced=entry.related?.filter(other=>state.items.some(item=>normalize(item.english)===normalize(other.english)))||[];if(practiced.length){const related=document.createElement('span');related.className='review-related';related.textContent='关联：'+practiced.map(other=>other.english).join('、');li.append(related);}
        return li;
      }));$('result-title').focus({preventScroll:true});
    }

    function edit(){saveDeviceSession();saveEditorDraft();renderDeviceLibrary();persistMistakes();state.browse=null;cancelLookup();stopSpeech();notice('');setView('setup');updateCount();showSetupRoute(state.returnRoute||'lists',{focus:true});}
    try{const saved=localStorage.getItem('speakey.order.v1');if(['sequential','random'].includes(saved))document.querySelector('input[name="order"][value="'+saved+'"]').checked=true;}catch{}
    document.querySelectorAll('input[name="order"]').forEach(input=>input.addEventListener('change',()=>{try{localStorage.setItem('speakey.order.v1',input.value);}catch{}}));
    $('word-list').addEventListener('input',updateCount);
    $('sample').addEventListener('click',()=>{derivativeChoice.keys.clear();$('word-list').value='Monopoly 垄断/独裁\nChilled mineral water 冰的矿泉水\nChill 冷静 凉 放松\nOccupation 职业\nJournalist 记者\nReturn ticket 往返票\nSingle ticket 单程票\nOne-way ticket 单程票\nDelay 推迟\nParticularly 尤其地\nEspecially 特别地\nPlatform 月台\nCottage 村舍/茅屋\nGarage 车库\nMonument 纪念碑';updateCount();$('word-list').focus();});
    $('rate').addEventListener('input',()=>{$('rate-value').textContent=Number($('rate').value).toFixed(2)+'×';});
    $('retry-mistakes').addEventListener('click',retryMistakes);
    $('test-without-meaning').addEventListener('click',()=>{$('preview-meaning').checked=false;preferredPreviewMeaning=false;try{localStorage.setItem('speakey.preview-meaning.v1','false');}catch{}restartSession();});
    $('start').addEventListener('click',start);$('restart').addEventListener('click',restartSession);$('back').addEventListener('click',edit);$('edit').addEventListener('click',edit);
    $('replay').addEventListener('click',()=>{sayCurrent();if(!state.readingCorrection&&!state.browse){$('answer').focus({preventScroll:true});queueAnswerVisibility();}});
    $('answer-form').addEventListener('submit',event=>{event.preventDefault();checkAnswer();});
    $('answer-form').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.isComposing||event.keyCode===229||event.repeat))event.preventDefault();});
    $('answer').addEventListener('keydown',event=>{
      if(event.key==='Tab'&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&state.view==='practice'&&state.phase!=='correct'){
        event.preventDefault();if(!event.repeat&&!event.isComposing)sayCurrent();
      }
    });

    // Browsing completed occurrences never calls renderWord or re-scores them.
    function syncPrevious(){
      $('previous-word').disabled=state.index<=0;
      $('previous-result').disabled=!state.words.length;
    }
    function previousWord(){
      if(!['practice','result'].includes(state.view)||state.index<=0)return;
      stopSpeech();
      if(!state.browse){
        state.browse={index:state.index,view:state.view,phase:state.phase,wasReview:state.wasReview,
          meaningMarked:state.meaningMarked,readingCorrection:state.readingCorrection,
          answer:$('answer').value,invalid:$('answer').getAttribute('aria-invalid'),
          answerClass:$('answer').className,readOnly:$('answer').readOnly,checkText:$('check').textContent,
          title:$('practice-title').textContent,feedback:state.feedback,
          concealed:!!$('feedback').querySelector('.concealed'),reviewHidden:$('review-status').hidden,
          reviewParts:Array.from($('review-status').children,node=>node.textContent)};
      }
      state.index--;setView('practice');state.readingCorrection=false;
      $('practice').classList.remove('reading-correction');
      state.phase='correct';const entry=state.words[state.index];
      state.meaningMarked=state.markedVisits.has(state.index)&&entry.needsReview&&!entry.mastered;
      $('answer').value=entry.english;$('answer').readOnly=true;
      $('answer').hidden=true;$('history-answer').textContent=entry.english;$('history-answer').hidden=false;
      $('answer').classList.remove('correct');$('answer').setAttribute('aria-invalid','false');
      $('practice-title').textContent='回看已答词';
      $('review-status').hidden=false;setInfo('review-status',['回看已答词']);
      showFeedback(entry,'核对中文释义',{neutral:true,help:'如果意思记错了，可以将本词加入错词复习。'});
      $('check').textContent='返回当前进度 ↵';$('replay').disabled=false;
      syncSelfCheck();updateListeningControls();updateProgress();syncPrevious();syncLearningMeaning();
      notice('');setInfo('speech-status',['点击喇叭重听']);$('check').focus({preventScroll:true});
    }
    function resumeProgress(){
      const saved=state.browse;if(!saved)return;
      $('history-answer').hidden=true;$('history-answer').textContent='';$('answer').hidden=false;
      stopSpeech();state.browse=null;state.index=saved.index;
      if(saved.view==='result'){
        // A word marked wrong from the results must receive its two reviews.
        if(state.index<state.words.length){setView('practice');renderWord();}else finish();
        return;
      }
      Object.assign(state,{phase:saved.phase,wasReview:saved.wasReview,meaningMarked:saved.meaningMarked,readingCorrection:saved.readingCorrection});
      $('practice').classList.toggle('reading-correction',!!state.readingCorrection);
      $('answer').value=saved.answer;$('answer').readOnly=saved.readOnly;
      $('answer').className=saved.answerClass;$('answer').setAttribute('aria-invalid',saved.invalid);
      $('check').textContent=saved.checkText;$('practice-title').textContent=saved.title;
      if(saved.feedback){showFeedback(saved.feedback.entry,saved.feedback.message,saved.feedback.options);if(saved.concealed)concealCorrection();}
      else{state.feedback=null;$('feedback').hidden=true;$('feedback').replaceChildren();}
      $('review-status').hidden=saved.reviewHidden;setInfo('review-status',saved.reviewParts);
      $('replay').disabled=state.phase==='correct';syncSelfCheck();updateListeningControls();updateProgress();syncPrevious();syncLearningMeaning();
      if(state.phase==='correct'||state.readingCorrection){setInfo('speech-status',[state.phase==='correct'?'已作答':'查看正确拼写']);$('check').focus({preventScroll:true});}
      else{$('answer').focus({preventScroll:true});queueAnswerVisibility();sayCurrent();}
    }
    $('previous-word').addEventListener('click',previousWord);
    $('previous-result').addEventListener('click',previousWord);
    document.addEventListener('keydown',event=>{
      if(event.key!=='ArrowUp'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing||event.keyCode===229)return;
      if(!['practice','result'].includes(state.view))return;
      const target=event.target;
      if(target.isContentEditable||target.matches('textarea,select')||(target.matches('input')&&target.id!=='answer'))return;
      event.preventDefault();if(!event.repeat)previousWord();
    });

    function readCorrection(){
      state.readingCorrection=true;$('practice').classList.add('reading-correction');
      $('answer').blur();$('answer').readOnly=true;
      $('check').textContent='开始重拼';$('check').focus({preventScroll:true});
      clearTimeout(answerFocusTimer);queueAnswerVisibility();
      // Wait for the keyboard animation, then show the answer and its action together.
      const reveal=()=>{if(state.view==='practice'&&state.readingCorrection)$('feedback').scrollIntoView({block:'start',behavior:'auto'});};
      requestAnimationFrame(reveal);setTimeout(reveal,350);
    }
    function beginRetype(){
      concealCorrection();state.readingCorrection=false;$('practice').classList.remove('reading-correction');
      $('answer').readOnly=false;$('check').textContent='检查订正 ↵';
      $('answer').focus({preventScroll:true});queueAnswerVisibility();saveDeviceSession();
    }
    function concealCorrection(){
      if(state.phase!=='retry')return;
      const correction=$('feedback').querySelector('.correction-answer');
      if(!correction||correction.classList.contains('concealed'))return;
      correction.style.minHeight=correction.getBoundingClientRect().height+'px';
      correction.classList.add('concealed');correction.querySelector('.correction-label').textContent='答案已隐藏，试着凭记忆拼写';
      const word=correction.querySelector('.spelling');word.textContent='';word.setAttribute('aria-hidden','true');
      $('answer').setAttribute('aria-invalid','false');
    }
    // beforeinput also covers paste and composition; input is a fallback for older browsers.
    $('answer').addEventListener('beforeinput',event=>{if(!event.defaultPrevented&&event.inputType?.startsWith('insert'))concealCorrection();});
    $('answer').addEventListener('input',()=>{if($('answer').value)concealCorrection();});
    const builtinVocabulary=JSON.parse($('builtin-vocabulary').textContent);
    const historyKey='speakey.mistake-rounds.v1';
    let mistakeHistory=[],historyRecords=[],historyWriteFailed=false;
    const pendingHistoryDeletes=new Map();
    function readHistoryRecords(){
      if(historyWriteFailed)return historyRecords;
      try{
        const rows=JSON.parse(localStorage.getItem(historyKey)||'[]');
        if(!Array.isArray(rows))return [];
        return rows.filter(r=>r&&typeof r.id==='string'&&Number.isFinite(r.created)&&(r.deleted===true||Array.isArray(r.words)))
          .map(r=>r.deleted?{id:r.id,created:r.created,deleted:true}:{...r,words:r.words.filter(w=>w&&typeof w.english==='string'&&/[a-z]/i.test(w.english))}).filter(r=>r.deleted||r.words.length);
      }catch{return historyRecords;}
    }
    function readMistakeHistory(){
      historyRecords=readHistoryRecords();
      return historyRecords.filter(r=>!r.deleted).sort((a,b)=>b.created-a.created).slice(0,50);
    }
    function writeHistoryRecords(records,{retainOnFailure=false}={}){
      // One storage write commits both the removed record and its suppression marker.
      // Only IDs/timestamps remain for deletion; no deleted word content is retained.
      const next=[...records.filter(r=>r.deleted),...records.filter(r=>!r.deleted).sort((a,b)=>b.created-a.created).slice(0,50)];
      try{localStorage.setItem(historyKey,JSON.stringify(next));historyRecords=next;historyWriteFailed=false;$('history-save-warning').hidden=true;return true;}
      catch{if(retainOnFailure){historyRecords=next;historyWriteFailed=true;}$('history-save-warning').hidden=false;return false;}
    }
    function expireHistoryUndo(id){
      const pending=pendingHistoryDeletes.get(id);if(!pending)return;
      const row=Array.from($('mistake-rows').children).find(li=>li.dataset.roundId===id);
      // Do not remove an undo control while it has keyboard focus or is being pointed at.
      if(row&&(row.contains(document.activeElement)||row.matches(':hover'))){pending.timer=setTimeout(()=>expireHistoryUndo(id),2000);return;}
      pendingHistoryDeletes.delete(id);renderMistakeHistory();
    }
    function deleteMistakeRound(id,height=0){
      const records=readHistoryRecords(),round=records.find(r=>r.id===id&&!r.deleted);if(!round)return;
      const next=records.filter(r=>r.id!==id);next.push({id,created:round.created,deleted:true});
      if(!writeHistoryRecords(next)){historyActionMessage('删除未保存，请稍后重试。原记录仍保留。');return;}
      const pending={round,height,timer:setTimeout(()=>expireHistoryUndo(id),10000)};pendingHistoryDeletes.set(id,pending);
      refreshMistakeHistory();historyActionMessage('已删除这轮错词记录，可以撤销。');
      Array.from($('mistake-rows').children).find(li=>li.dataset.roundId===id)?.querySelector('.mistake-undo')?.focus({preventScroll:true});
    }
    function undoMistakeDelete(id){
      const pending=pendingHistoryDeletes.get(id);if(!pending)return;
      const records=readHistoryRecords(),current=records.find(r=>r.id===id);
      // An undo from another tab may already have restored it; never overwrite that record.
      const next=current&&!current.deleted?records:[...records.filter(r=>r.id!==id),pending.round];
      if(!writeHistoryRecords(next)){historyActionMessage('撤销未保存，请稍后重试。');return;}
      clearTimeout(pending.timer);pendingHistoryDeletes.delete(id);refreshMistakeHistory();historyActionMessage('已恢复这轮错词记录。');
      Array.from($('mistake-rows').children).find(li=>li.dataset.roundId===id)?.querySelector('.mistake-replay')?.focus({preventScroll:true});
    }
    function historyActionMessage(text){$('history-action-status').textContent=text;}
    const historyStatus=document.createElement('p');historyStatus.id='history-action-status';historyStatus.className='sr-only';historyStatus.setAttribute('role','status');$('mistake-rows').before(historyStatus);
    function historyDisplayRows(){
      const rows=mistakeHistory.map(round=>({round}));
      for(const [id,pending] of pendingHistoryDeletes)if(!mistakeHistory.some(r=>r.id===id))rows.push({round:pending.round,pending});
      return rows.sort((a,b)=>b.round.created-a.round.created);
    }
    function renderMistakeHistory(){
      $('saved-empty').hidden=!!mistakeHistory.length||!!pendingHistoryDeletes.size;
      $('review-count').textContent=mistakeHistory.length||'';
      $('review-intro').hidden=!mistakeHistory.length;
      $('mistake-rows').replaceChildren(...historyDisplayRows().map(({round,pending})=>{
        const li=document.createElement('li'),text=document.createElement('div'),title=document.createElement('h2'),meta=document.createElement('p'),preview=document.createElement('p'),button=document.createElement('button');
        const d=new Date(round.created),pad=n=>String(n).padStart(2,'0');
        li.className='mistake-row';li.dataset.roundId=round.id;title.textContent=round.label||'听写练习';
        meta.className='hint';meta.textContent=`${d.getMonth()+1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        preview.className='mistake-preview';preview.textContent=round.words.slice(0,4).map(w=>w.english).join('、')+(round.words.length>4?'…':'');
        const count=document.createElement('p');count.className='hint';count.textContent=round.mode==='recognition'?'认词需巩固 '+round.words.length+' 项':round.words.length+' 个错词';
        text.append(title,meta,count);button.type='button';button.className='secondary mistake-replay';button.textContent='再练一遍';button.setAttribute('aria-label','复习 '+title.textContent+' '+meta.textContent);button.onclick=()=>openMistakeRound(round);
        const actions=document.createElement('div');actions.className='mistake-actions';
        if(pending){
          li.classList.add('is-deleted');li.style.minHeight=pending.height?pending.height+'px':'';count.textContent='这轮错词记录已删除';
          button.className='secondary mistake-undo';button.textContent='撤销';button.setAttribute('aria-label','撤销删除 '+title.textContent+' '+meta.textContent);button.onclick=()=>undoMistakeDelete(round.id);actions.append(button);li.append(text,actions);
        }else{
          const remove=document.createElement('button');remove.type='button';remove.className='text-button mistake-delete';remove.textContent='删除';remove.setAttribute('aria-label','删除错词记录 '+title.textContent+' '+meta.textContent);
          remove.onclick=()=>deleteMistakeRound(round.id,li.getBoundingClientRect().height);actions.append(button,remove);li.append(text,actions,preview);
        }return li;
      }));
    }
    function persistMistakes(){
      if(!state.roundId||!state.items.length)return;
      const existing=readHistoryRecords();
      if(existing.some(r=>r.id===state.roundId&&r.deleted)){refreshMistakeHistory();return;}
      const words=roundMistakes().map(entry=>{
        applyKnownMeaning(entry);
        const {english,chinese,meaningSource,usage,groupId,variantIndex,related}=entry;
        return {english,chinese,meaningSource,usage,groupId,variantIndex,related};
      });
      const records=existing.filter(r=>r.id!==state.roundId);
      if(words.length)records.push({id:state.roundId,created:state.roundCreated,complete:state.roundComplete,label:state.libraryContext?.label||'听写练习',mode:state.libraryContext?.mode||'dictation',words});
      writeHistoryRecords(records,{retainOnFailure:true});refreshMistakeHistory();
    }
    function refreshMistakeHistory(){mistakeHistory=readMistakeHistory();renderMistakeHistory();}
    function addBuiltinVocabulary(){
      if($('builtin-book').value==='listening-class'){addClassVocabulary();return;}
      const choice=$('builtin-group').value;
      const group=choice==='all'?{lines:builtinVocabulary.groups.flatMap(g=>g.lines),derivedLines:builtinVocabulary.groups.flatMap(g=>g.derivedLines)}:builtinVocabulary.groups[Number(choice)];
      const incoming=parseWords(group.lines.join('\n')).words;
      const derived=derivativeKeys(group.lines.filter(line=>!group.derivedLines.includes(line)),group.derivedLines);
      const existing=new Set();
      const added=[],definitions=new Map();
      for(const entry of incoming){const key=normalize(entry.english);if(!definitions.has(key))definitions.set(key,new Set());if(entry.chinese)definitions.get(key).add(entry.chinese);}
      for(const entry of incoming){
        const key=normalize(entry.english);
        if(key&&!existing.has(key)){added.push(entry.english+'\t'+[...definitions.get(key)].join('；'));existing.add(key);}
      }
      prepareBuiltinList(builtinVocabulary.title+' '+(choice==='all'?'全部':'第 '+(Number(choice)+1)+' 组'),added.join('\n'),derived);
    }
    builtinVocabulary.groups.forEach((group,index)=>{
      const option=document.createElement('option');option.value=index;option.textContent=`第 ${index+1} 组（主词 ${group.from}–${group.to}）`;$('builtin-group').append(option);
    });
    const allOption=document.createElement('option');allOption.value='all';allOption.textContent='全部 2,796 个主词及派生词';$('builtin-group').append(allOption);
    $('builtin-add').addEventListener('click',addBuiltinVocabulary);
    window.addEventListener('storage',event=>{if(event.key===historyKey||event.key===null){historyWriteFailed=false;refreshMistakeHistory();}});
    window.addEventListener('pagehide',persistMistakes);
    refreshMistakeHistory();

    // Original handout numbers are the range boundaries; related words stay together.
    const classVocabulary=JSON.parse($('class-vocabulary').textContent);
    const classRangeKey='speakey.class-range.v1';
    const classRows=classVocabulary.rows.map(row=>{
      const entries=parseWords(row.text).words;
      entries.forEach(applyKnownMeaning);
      return {...row,entries,label:entries.map(w=>w.english).join(' / '),search:normalize(row.number+' '+row.source+' '+row.text+' '+entries.map(w=>w.chinese||'').join(' '))};
    });
    let lastRange=null;try{lastRange=JSON.parse(localStorage.getItem(classRangeKey)||'null');}catch{}
    for(const side of ['from','to']){
      const field=$('class-'+side);field.max=classRows.length;
      field.value=Number.isInteger(lastRange?.[side])&&lastRange[side]>=1&&lastRange[side]<=classRows.length?lastRange[side]:side==='from'?1:classRows.length;
      field.addEventListener('input',updateClassRange);
    }
    function readClassRange(){
      const from=$('class-from').valueAsNumber,to=$('class-to').valueAsNumber;
      return Number.isInteger(from)&&Number.isInteger(to)&&from>=1&&to<=classRows.length&&from<=to?{from,to}:null;
    }
    function classRowDescription(row){
      return row?row.label+(row.entries[0]?.chinese?' — '+row.entries[0].chinese:''):'';
    }
    function classPreviewRow(row,search=false){
      const li=document.createElement('li'),number=document.createElement('span'),text=document.createElement('div'),english=document.createElement('strong'),meaning=document.createElement('span');
      li.className='class-word-row';number.className='class-word-number';number.textContent=row.number;english.textContent=row.label;
      meaning.textContent=row.entries.map(w=>w.chinese).filter(Boolean).join(' / ');text.append(english,meaning);li.append(number,text);
      if(search){const actions=document.createElement('div');actions.className='class-word-actions';
        for(const [side,label]of [['from','设为起点'],['to','设为终点']]){const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=label;button.setAttribute('aria-label',label+'：第 '+row.number+' 号 '+row.label);button.onclick=()=>{
          $('class-'+side).value=row.number;updateClassRange();$('class-selection-notice').textContent='已将第 '+row.number+' 号设为'+(side==='from'?'起点':'终点')+'。';
        };actions.append(button);}li.append(actions);
      }return li;
    }
    function updateClassRange(){
      const range=readClassRange();
      for(const side of ['from','to']){
        const field=$('class-'+side),n=field.valueAsNumber;
        $('class-'+side+'-word').textContent=Number.isInteger(n)&&n>=1&&n<=classRows.length?classRowDescription(classRows[n-1]):'请输入 1–'+classRows.length+' 的整数编号';
        field.setAttribute('aria-invalid',String(!Number.isInteger(n)||n<1||n>classRows.length||($('class-from').valueAsNumber>$('class-to').valueAsNumber)));
      }
      $('class-range-error').hidden=!!range;$('class-range-error').textContent=range?'':'请填写有效的起止编号，终点不能早于起点。';
      $('class-preview').replaceChildren();
      if(range){const rows=classRows.slice(range.from-1,range.to),total=rows.reduce((n,row)=>n+row.entries.length,0);
        $('class-range-summary').textContent='第 '+range.from+'–'+range.to+' 号，共 '+rows.length+' 条原文';
        $('class-range-detail').textContent='包含关联表达共 '+total+' 个听写项，可在下一步选择是否听写关联词。';
        if($('class-preview-details').open)$('class-preview').replaceChildren(...rows.map(row=>classPreviewRow(row)));
        try{localStorage.setItem(classRangeKey,JSON.stringify(range));}catch{}
      }else{$('class-range-summary').textContent='尚未选定范围';$('class-range-detail').textContent='';}
      if($('builtin-book').value==='listening-class')$('builtin-add').disabled=!range;
    }
    function searchClassRows(){
      const value=normalize($('class-search').value),matches=value?classRows.filter(row=>row.search.includes(value)):[];
      $('class-search-results').replaceChildren(...matches.slice(0,12).map(row=>classPreviewRow(row,true)));
      $('class-search-status').textContent=!value?'输入英文、中文或原文编号查找。':!matches.length?'未找到匹配词条。':matches.length>12?'找到 '+matches.length+' 条，先显示前 12 条；输入更完整的词可缩小范围。':'找到 '+matches.length+' 条';
    }
    function selectBuiltinBook(){
      const course=$('builtin-book').value==='listening-class';
      $('builtin-title').textContent=course?classVocabulary.title:builtinVocabulary.title;
      $('builtin-description').textContent=course?'保留原词表的 1–272 号。按课堂进度选择起点和终点，两个端点都包含在内。':'2,796 个主词，按原书顺序分组。选定范围后，再选择练习方式。';
      $('class-range-controls').hidden=!course;$('classic-group-controls').hidden=course;
      $('builtin-add').textContent='下一步 →';$('builtin-add').disabled=course&&!readClassRange();
      if(course)updateClassRange();
    }
    function addClassVocabulary(){
      const range=readClassRange();if(!range)return;
      const rows=classRows.slice(range.from-1,range.to);
      prepareBuiltinList(classVocabulary.title+' '+range.from+'–'+range.to+'号',rows.map(row=>row.text).join('\n'));
    }
    $('builtin-book').addEventListener('change',selectBuiltinBook);
    $('class-search').addEventListener('input',searchClassRows);
    $('class-preview-details').addEventListener('toggle',updateClassRange);
    searchClassRows();selectBuiltinBook();

    // Device-local lists and resumable rounds. Queue IDs retain shared review state.
    const deviceKeys={lists:'speakey.word-library.v1',sessions:'speakey.sessions.v1',draft:'speakey.editor.v1'};
    let deviceLists=[],deviceSessions=[],selectedLists=new Set(),editorListId=null,deviceSaveTimer=null;
    let deviceRestoring=false;
    let combiningLists=false,launchPlan=null;
    let openListMenu=null,listMenuPlacement=null;
    function closeListMenus({restoreFocus=false}={}){
      const trigger=openListMenu?.querySelector('summary');
      for(const menu of document.querySelectorAll('.list-menu[open]')){
        menu.open=false;menu.querySelector('summary').setAttribute('aria-expanded','false');
      }
      openListMenu=null;listMenuPlacement=null;
      if(restoreFocus&&trigger?.isConnected&&trigger.getClientRects().length)trigger.focus({preventScroll:true});
    }
    function positionListMenu(menu){
      const panel=menu.querySelector('.list-menu-panel'),anchor=menu.querySelector('summary').getBoundingClientRect(),vp=window.visualViewport;
      const left=vp?.offsetLeft||0,top=vp?.offsetTop||0,width=vp?.width||document.documentElement.clientWidth,height=vp?.height||innerHeight,pad=8,gap=4;
      panel.style.maxWidth=Math.max(1,width-2*pad)+'px';panel.style.maxHeight=Math.max(1,height-2*pad)+'px';
      const needed=panel.getBoundingClientRect().height,below=top+height-pad-anchor.bottom-gap,above=anchor.top-top-pad-gap;
      const down=below>=needed||below>=above;
      panel.style.maxHeight=Math.max(1,down?below:above)+'px';
      const rect=panel.getBoundingClientRect();
      panel.style.left=Math.max(left+pad,Math.min(anchor.right-rect.width,left+width-pad-rect.width))+'px';
      panel.style.top=Math.max(top+pad,Math.min(down?anchor.bottom+gap:anchor.top-gap-rect.height,top+height-pad-rect.height))+'px';
      listMenuPlacement=[anchor.top,anchor.left,width,height,left,top];
    }
    function openWordListMenu(menu){
      if(!menu.isConnected||!menu.getClientRects().length)return;
      closeListMenus();menu.open=true;openListMenu=menu;
      menu.querySelector('summary').setAttribute('aria-expanded','true');positionListMenu(menu);
    }
    function dismissListMenuOutside(event){if(openListMenu&&!openListMenu.contains(event.target))closeListMenus();}
    function dismissMovedListMenu(){
      if(!openListMenu||!listMenuPlacement)return;
      const rect=openListMenu.querySelector('summary').getBoundingClientRect(),vp=window.visualViewport;
      const current=[rect.top,rect.left,vp?.width||document.documentElement.clientWidth,vp?.height||innerHeight,vp?.offsetLeft||0,vp?.offsetTop||0];
      // A scroll event queued before the click must not close the newly positioned menu.
      if(current.some((value,i)=>Math.abs(value-listMenuPlacement[i])>0.5))closeListMenus();
    }
    document.addEventListener('pointerdown',dismissListMenuOutside,true);
    document.addEventListener('click',dismissListMenuOutside,true);
    document.addEventListener('focusin',dismissListMenuOutside);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&openListMenu){event.preventDefault();closeListMenus({restoreFocus:true});}
    });
    // Scrolling the menu itself is allowed on short screens; scrolling its page dismisses it.
    document.addEventListener('scroll',event=>{if(openListMenu&&!openListMenu.querySelector('.list-menu-panel').contains(event.target))dismissMovedListMenu();},true);
    window.addEventListener('resize',dismissMovedListMenu);
    window.visualViewport?.addEventListener('resize',dismissMovedListMenu);
    window.visualViewport?.addEventListener('scroll',dismissMovedListMenu);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)closeListMenus();});
    const deviceWriteFailures=new Set();
    function readDevice(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}
    function writeDevice(key,value){
      try{localStorage.setItem(key,JSON.stringify(value));deviceWriteFailures.delete(key);}
      catch{deviceWriteFailures.add(key);}
      $('device-save-warning').hidden=!deviceWriteFailures.size;
      return !deviceWriteFailures.has(key);
    }
    const deviceId=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    function storeDeviceRow(kind,row,remove=false){
      const memory=kind==='lists'?deviceLists:deviceSessions;
      const stored=readDevice(deviceKeys[kind],memory);
      const rows=(Array.isArray(stored)?stored:memory).filter(r=>r&&r.id!==row.id);
      // Retain in-memory changes if storage is currently unavailable/full.
      if(deviceWriteFailures.has(deviceKeys[kind]))for(const r of memory)if(r.id!==row.id&&!rows.some(x=>x.id===r.id))rows.push(r);
      if(!remove)rows.push(row);
      if(kind==='lists')deviceLists=rows.sort((a,b)=>a.created-b.created);else deviceSessions=rows;
      return writeDevice(deviceKeys[kind],rows);
    }
    function saveEditorDraft(){
      if(deviceRestoring)return;
      writeDevice(deviceKeys.draft,{text:$('word-list').value,name:$('list-name').value,id:editorListId,derived:[...derivativeChoice.keys],selected:[...selectedLists]});
      $('save-list').disabled=!$('word-list').value.trim();
      $('save-list').textContent='仅保存';
      refreshSetupDraft();
    }
    function saveNamedList(name,text,derived=[],id=null){
      const count=parseWords(text).words.length;if(!count)return null;
      const prior=deviceLists.find(r=>r.id===id),now=Date.now();
      const unchanged=prior&&prior.text===text&&JSON.stringify([...(prior.derived||[])].sort())===JSON.stringify([...derived].sort());
      const row={id:prior?.id||deviceId(),name:(name||'未命名词表').trim().slice(0,120),text,derived:[...derived],count,created:prior?.created||now,updated:unchanged?prior.updated:now,completed:unchanged?prior.completed:undefined};
      const saved=storeDeviceRow('lists',row);
      renderDeviceLibrary();saveEditorDraft();
      $('device-library-status').textContent=saved?'已保存“'+row.name+'”。':'“'+row.name+'”暂存在本页，设备保存失败。';
      return row;
    }
    function loadNamedList(id){
      const row=deviceLists.find(r=>r.id===id);if(!row)return;
      const editing=deviceLists.find(r=>r.id===editorListId),draft=$('word-list').value;
      if(draft.trim()&&(!editing||editing.text!==draft||editing.name!==$('list-name').value)&&!confirm('当前还有未保存的编辑内容。放弃这些修改并打开“'+row.name+'”？'))return;
      editorListId=id;$('word-list').value=row.text;$('list-name').value=row.name;
      derivativeChoice.keys=new Set(row.derived||[]);updateCount();saveEditorDraft();
      showPreparation('paste',{focus:true});
      $('word-list').focus({preventScroll:true});$('word-list').scrollIntoView({block:'nearest'});
    }
    function selectedSession(selection=[...selectedLists]){
      const ids=selection.slice().sort().join('|');
      return deviceSessions.filter(s=>(s.context?.listIds||[]).slice().sort().join('|')===ids&&ids&&
        (s.context.listIds||[]).every(id=>deviceLists.find(r=>r.id===id)?.updated===s.context.versions?.[id]))
        .sort((a,b)=>b.updated-a.updated)[0];
    }
    function syncSelectedLists(){
      $('start-lists').disabled=!selectedLists.size;
      $('start-lists').textContent=selectedSession()?'继续这组练习':'下一步 →';
      $('selected-lists-count').textContent=selectedLists.size?'已选 '+selectedLists.size+' 份，一起练习':'勾选要一起练习的词表';
      $('device-library-actions').hidden=!combiningLists||!deviceLists.length;
      $('combine-lists').textContent=combiningLists?'取消合并':'合并练习';
      $('combine-lists').setAttribute('aria-pressed',String(combiningLists));
      $('device-library').classList.toggle('is-combining',combiningLists);
      $('shelf-heading').hidden=!deviceLists.length;
      $('lists-settings-slot').hidden=true;
    }
    function renderDeviceLibrary(){
      closeListMenus();
      selectedLists=new Set([...selectedLists].filter(id=>deviceLists.some(r=>r.id===id)));
      $('device-library-empty').hidden=!!deviceLists.length;
      $('device-library-actions').hidden=!deviceLists.length;
      $('device-list-count').textContent=deviceLists.length?deviceLists.length+' 份':'';
      $('device-list-rows').replaceChildren(...deviceLists.map(row=>{
        const item=document.createElement('li'),label=document.createElement('label'),box=document.createElement('input'),text=document.createElement('span'),name=document.createElement('strong'),meta=document.createElement('span'),actions=document.createElement('div');
        item.className='device-list-row';label.className='device-list-label';box.type='checkbox';box.value=row.id;box.checked=selectedLists.has(row.id);box.hidden=!combiningLists;box.setAttribute('aria-label','选择 '+row.name);item.classList.toggle('is-selected',combiningLists&&box.checked);
        name.textContent=row.name;meta.className='list-meta';
        const unfinished=selectedSession([row.id]),combined=deviceSessions.some(s=>s.context?.listIds?.length>1&&s.context.listIds.includes(row.id));
        const total=document.createElement('span'),progress=document.createElement('span');total.textContent=row.count+' 项';progress.textContent=unfinished?(unfinished.recognition?'认词已掌握 ':'听写已通过 ')+unfinished.items.filter(w=>w.mastered).length+'/'+unfinished.items.length:combined?'有合并练习进度':row.completed?'听写已练完':row.recognitionCompleted?'认词已练完':'未开始';meta.append(total,progress);
        text.append(name,meta);label.append(box,text);actions.className='device-row-actions';
        label.addEventListener('click',event=>{if(!combiningLists)event.preventDefault();});
        box.addEventListener('change',()=>{box.checked?selectedLists.add(row.id):selectedLists.delete(row.id);item.classList.toggle('is-selected',box.checked);syncSelectedLists();saveEditorDraft();});
        const editButton=document.createElement('button');editButton.type='button';editButton.className='text-button';editButton.textContent='编辑';editButton.setAttribute('aria-label','编辑 '+row.name);editButton.onclick=()=>loadNamedList(row.id);
        const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='删除';remove.setAttribute('aria-label','删除 '+row.name);
        remove.onclick=()=>{if(!confirm('删除“'+row.name+'”？已经开始的练习和历史错词仍会保留。'))return;storeDeviceRow('lists',row,true);selectedLists.delete(row.id);if(editorListId===row.id)editorListId=null;renderDeviceLibrary();saveEditorDraft();};
        const practice=document.createElement('button'),menu=document.createElement('details'),summary=document.createElement('summary'),menuActions=document.createElement('div');
        const existing=selectedSession([row.id]);
        practice.type='button';practice.className='secondary list-practice';practice.textContent=existing?'继续':'练习';practice.setAttribute('aria-label',practice.textContent+' '+row.name);practice.hidden=combiningLists;
        practice.onclick=()=>{if(existing)restoreDeviceSession(existing.id);else openPracticeSetup([row.id]);};
        menu.className='list-menu';menu.setAttribute('name','speakey-list-actions');summary.textContent='更多';summary.setAttribute('aria-label','更多操作：'+row.name);summary.setAttribute('aria-expanded','false');
        menuActions.className='list-menu-panel';menuActions.setAttribute('role','group');menuActions.setAttribute('aria-label',row.name+'的操作');menu.append(summary,menuActions);
        summary.addEventListener('click',event=>{event.preventDefault();if(menu.open)closeListMenus();else openWordListMenu(menu);});
        menu.addEventListener('toggle',()=>{if(menu.open&&openListMenu!==menu)openWordListMenu(menu);else if(!menu.open&&openListMenu===menu)closeListMenus();});
        menuActions.addEventListener('click',event=>{if(event.target.closest('button'))closeListMenus({restoreFocus:true});},true);
        const fresh=document.createElement('button');fresh.type='button';fresh.className='text-button';fresh.textContent='重新练一遍';fresh.hidden=!existing;fresh.onclick=()=>openPracticeSetup([row.id]);
        menuActions.append(fresh,editButton,remove);actions.append(practice,menu);item.append(label,actions);return item;
      }));
      $('unfinished-section').hidden=!deviceSessions.length;
      $('unfinished-count').textContent=deviceSessions.length+' 轮';
      $('unfinished-rows').replaceChildren(...deviceSessions.slice().sort((a,b)=>b.updated-a.updated).map(record=>{
        const li=document.createElement('li'),text=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('span'),button=document.createElement('button');li.className='resume-row';
        title.textContent=record.context?.label||'未完成练习';meta.className='hint';meta.textContent=(record.recognition?'认词已掌握 ':'听写已通过 ')+record.items.filter(w=>w.mastered).length+' / '+record.items.length+' 项';text.append(title,meta);
        button.type='button';button.className='secondary';button.textContent='继续';button.setAttribute('aria-label','继续 '+title.textContent);button.onclick=()=>restoreDeviceSession(record.id);
        const actions=document.createElement('div'),remove=document.createElement('button');actions.className='resume-actions';
        remove.type='button';remove.className='text-button';remove.textContent='删除';remove.setAttribute('aria-label','删除未完成练习 '+title.textContent);
        remove.onclick=()=>{
          if(!confirm('删除“'+title.textContent+'”的未完成进度？原词表和历史错词会保留。'))return;
          const saved=storeDeviceRow('sessions',record,true);
          renderDeviceLibrary();$('device-library-status').textContent=saved?'已删除这次练习进度。':'已从本页移除，但设备保存失败；重新打开后可能再次出现。';
        };
        actions.append(button,remove);li.append(text,actions);return li;
      }));syncSelectedLists();
    }
    function startSelectedLists(){
      const existing=selectedSession();if(existing){restoreDeviceSession(existing.id);return;}
      openPracticeSetup([...selectedLists]);
    }
    function collectListPractice(ids){
      const rows=deviceLists.filter(r=>ids.includes(r.id)),words=[],seen=new Map();
      for(const row of rows)for(const entry of practiceWords(parseWords(row.text).words,new Set(row.derived||[]))){
        const key=normalize(entry.english);if(seen.has(key)&&seen.get(key)!==row.id)continue;seen.set(key,row.id);
        words.push({...entry,groupId:row.id+':'+entry.groupId,sourceListId:row.id});
      }
      return {rows,words};
    }
    function editorSessionContext(){
      const row=deviceLists.find(r=>r.id===editorListId&&r.text===$('word-list').value);
      return {listIds:row?[row.id]:[],versions:row?{[row.id]:row.updated}:{},label:$('list-name').value.trim()||'当前词表'};
    }
    function sessionUI(){
      if(state.browse)return {...state.browse};
      return {index:state.index,view:state.view,phase:state.phase,wasReview:state.wasReview,meaningMarked:state.meaningMarked,readingCorrection:state.readingCorrection,
        answer:$('answer').value,invalid:$('answer').getAttribute('aria-invalid'),answerClass:$('answer').className,readOnly:$('answer').readOnly,
        checkText:$('check').textContent,title:$('practice-title').textContent,feedback:state.feedback,
        concealed:!!$('feedback').querySelector('.concealed'),reviewHidden:$('review-status').hidden,reviewParts:Array.from($('review-status').children,n=>n.textContent)};
    }
    function saveDeviceSession(){
      if(state.view==='recognition'){saveRecognitionSession();return;}
      if(deviceRestoring||!state.roundId||!state.items.length||!['practice','result'].includes(state.view))return;
      const ui=sessionUI(),done=ui.view==='result'&&ui.index>=state.words.length;
      if(done){
        storeDeviceRow('sessions',{id:state.roundId},true);
        for(const id of state.libraryContext?.listIds||[]){const row=deviceLists.find(r=>r.id===id);if(row&&row.updated===state.libraryContext.versions?.[id]&&!row.completed)storeDeviceRow('lists',{...row,completed:Date.now()});}
        renderDeviceLibrary();return;
      }
      if(ui.feedback)ui.feedback={...ui.feedback,entryId:ui.feedback.entry.id,entry:undefined};
      const record={id:state.roundId,created:state.roundCreated,updated:Date.now(),context:state.libraryContext||{label:'当前词表',listIds:[]},
        items:state.items,queue:state.words.map(w=>w.id),ui,previewMeaning:!!state.previewMeaning,first:state.first,errors:[...state.errors],marked:[...state.markedVisits],
        changes:[...state.meaningChanges].map(([i,c])=>[i,{...c,entryId:c.entry.id,entry:undefined}]),
        savedReviewBase:state.savedReviewBase||null,submissionUndo:state.submissionUndo||null};
      // Store a detached snapshot: switching rounds must not mutate paused progress.
      storeDeviceRow('sessions',JSON.parse(JSON.stringify(record)));renderDeviceLibrary();
    }
    function validDeviceSession(r){
      if(r?.recognition)return typeof r.id==='string'&&Array.isArray(r.items)&&r.items.length&&r.items.every((w,i)=>w&&w.id===i&&typeof w.english==='string')&&validRecognitionSession(r);
      return r&&typeof r.id==='string'&&Array.isArray(r.items)&&r.items.length&&r.items.every((w,i)=>w&&w.id===i&&typeof w.english==='string')&&
        Array.isArray(r.queue)&&r.queue.every(id=>Number.isInteger(id)&&id>=0&&id<r.items.length)&&r.ui&&Number.isInteger(r.ui.index)&&r.ui.index>=0&&r.ui.index<r.queue.length;
    }
    function restoreDeviceSession(id){
      saveDeviceSession();const stored=deviceSessions.find(s=>s.id===id);if(!validDeviceSession(stored))return;
      const record=JSON.parse(JSON.stringify(stored));deviceRestoring=true;cancelLookup();stopSpeech();
      try{
        if(record.recognition){restoreRecognitionSession(record);return;}
        state.recognition=null;
        state.items=record.items;state.words=record.queue.map(id=>state.items[id]);state.errors=new Set(record.errors);state.markedVisits=new Set(record.marked);
        state.meaningChanges=new Map(record.changes.map(([i,c])=>[i,{...c,entry:state.items[c.entryId]}]));
        state.index=record.ui.index;state.first=record.first;state.roundId=record.id;state.roundCreated=record.created;state.roundComplete=false;state.previewMeaning=!!record.previewMeaning;
        state.libraryContext=record.context;state.returnRoute=record.context?.returnRoute||'lists';state.savedReviewBase=record.savedReviewBase;state.submissionUndo=record.submissionUndo||null;$('practice').style.minHeight='';
        if(record.ui.feedback)record.ui.feedback.entry=state.items[record.ui.feedback.entryId];
        setView('practice');state.browse={...record.ui,view:'practice'};
        if(record.ui.view==='result'){state.browse=null;renderWord();}else resumeProgress();
        // A correction opened on a phone must use its keyboard-free reading step.
        if(state.phase==='retry'&&!record.ui.concealed&&compactScreen.matches&&!state.readingCorrection)readCorrection();
        prepareMeanings();warmAudio();
      }finally{deviceRestoring=false;}saveDeviceSession();
    }
    function flushDeviceProgress(){clearTimeout(deviceSaveTimer);saveEditorDraft();saveDeviceSession();}
    $('save-list').addEventListener('click',()=>{if(savePreparedList())showSetupRoute('lists',{focus:true});});
    $('new-list').addEventListener('click',()=>showPreparation('paste',{fresh:true,focus:true}));
    $('start-lists').addEventListener('click',startSelectedLists);
    $('combine-lists').addEventListener('click',()=>{combiningLists=!combiningLists;selectedLists.clear();renderDeviceLibrary();saveEditorDraft();});
    $('list-name').addEventListener('input',saveEditorDraft);
    $('answer').addEventListener('input',()=>{clearTimeout(deviceSaveTimer);deviceSaveTimer=setTimeout(saveDeviceSession,250);});
    window.addEventListener('pagehide',flushDeviceProgress);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)flushDeviceProgress();});
    window.addEventListener('storage',event=>{if([deviceKeys.lists,deviceKeys.sessions].includes(event.key)){readDeviceLibrary();renderDeviceLibrary();}});
    function readDeviceLibrary(){
      const lists=readDevice(deviceKeys.lists,deviceLists),sessions=readDevice(deviceKeys.sessions,deviceSessions);
      deviceLists=Array.isArray(lists)?lists.filter(r=>r&&typeof r.id==='string'&&typeof r.name==='string'&&typeof r.text==='string'):[];
      deviceSessions=Array.isArray(sessions)?sessions.filter(validDeviceSession):[];
    }
    readDeviceLibrary();
    const savedEditor=readDevice(deviceKeys.draft,null);
    if(savedEditor&&typeof savedEditor.text==='string'){
      $('word-list').value=savedEditor.text;$('list-name').value=savedEditor.name||'';editorListId=savedEditor.id;
      derivativeChoice.keys=new Set(savedEditor.derived||[]);selectedLists=new Set(savedEditor.selected||[]);
    }
    renderDeviceLibrary();

    // Organize setup around choosing, preparing, and revisiting a practice list.
    function showSetupRoute(route,{focus=false}={}){
      closeListMenus();
      setupRoute=route;
      for(const name of ['lists','review','prepare','ready'])$(name+'-pane').hidden=name!==route;
      const preparing=route==='prepare'||route==='ready';
      $('workspace-homebar').hidden=preparing;$('prepare-top').hidden=!preparing;
      $('prepare-back').textContent=route==='ready'&&launchPlan?.returnRoute==='review'?'← 返回错词复习':'← 返回首页';
      $('setup-title').textContent=route==='lists'?'今天练什么？':route==='review'?'错词复习':route==='ready'?'选择练习方式':prepSource==='paste'?(editorListId?'编辑词表':'准备词表'):prepSource==='file'?'导入词表':'选择听写范围';
      $('nav-lists').setAttribute('aria-selected',String(route==='lists'));
      $('nav-review').setAttribute('aria-selected',String(route==='review'));
      $('nav-lists').tabIndex=route==='review'?-1:0;$('nav-review').tabIndex=route==='review'?0:-1;
      $('setup').dataset.route=route;
      const options=$('session-options');$('ready-settings-slot').append(options);
      options.hidden=route!=='ready';
      $('new-session-settings').hidden=false;
      if(route==='review')refreshMistakeHistory();
      refreshSetupDraft();syncSelectedLists();
      if(focus)$('setup-title').focus({preventScroll:true});
    }
    function showPreparation(source='paste',{fresh=false,focus=false}={}){
      // A saved, unedited list is safe to leave; an unsaved draft stays intact.
      if(fresh&&source==='paste'&&editorListId){
        const row=deviceLists.find(r=>r.id===editorListId);
        if(!row||(row.text===$('word-list').value&&row.name===$('list-name').value)){editorListId=null;$('word-list').value='';$('list-name').value='';derivativeChoice.keys.clear();}
      }
      prepSource=source;
      for(const name of ['paste','file','builtin']){
        $('source-'+name).hidden=source!==name;
        $('choose-'+name).setAttribute('aria-selected',String(source===name));
        $('choose-'+name).tabIndex=source===name?0:-1;
      }
      $('prepare-actions').hidden=source!=='paste';showSetupRoute('prepare',{focus});updateCount();
      selectBuiltinBook();
    }
    function refreshSetupDraft(){
      const row=deviceLists.find(r=>r.id===editorListId),text=$('word-list').value;
      const dirty=!!text.trim()&&(!row||row.text!==text||row.name!==$('list-name').value);
      $('draft-entry').hidden=!dirty;
      $('draft-title').textContent=editorListId?'还有未保存的修改':'还有一份词表草稿';
    }
    function savePreparedList(){
      const row=saveNamedList($('list-name').value,$('word-list').value,derivativeChoice.keys,editorListId);
      if(row){editorListId=row.id;$('list-name').value=row.name;saveEditorDraft();}
      return row;
    }
    function openMistakeRound(round){
      openPracticeSetup([],{words:round.words.map(w=>({...w})),label:round.label?round.label+'（错词）':'错词复习',returnRoute:'review',mode:round.mode});
    }
    // All new rounds have one explicit content -> mode -> start transition.
    function openPracticeSetup(ids,options={}){
      selectedLists=new Set(ids.filter(id=>deviceLists.some(row=>row.id===id)));
      launchPlan={ids:[...selectedLists],...options};
      $('preview-meaning').checked=preferredPreviewMeaning;
      for(const radio of document.querySelectorAll('input[name="practice-mode"]'))radio.checked=radio.value===(options.mode==='recognition'?'recognize':preferredPreviewMeaning?'learn':'test');
      $('ready-more').open=false;
      showSetupRoute('ready',{focus:true});refreshPracticeSetup();saveEditorDraft();
      $('setup-title').scrollIntoView({block:'start'});
    }
    function practiceSetupContent(){
      if(launchPlan?.words)return {words:launchPlan.words,context:{listIds:[],label:launchPlan.label,returnRoute:'review'},names:[launchPlan.label]};
      const {rows,words}=collectListPractice(launchPlan?.ids||[]);
      return {words,context:{listIds:rows.map(r=>r.id),versions:Object.fromEntries(rows.map(r=>[r.id,r.updated])),label:rows.map(r=>r.name).join('、'),returnRoute:'lists'},names:rows.map(r=>r.name)};
    }
    function refreshPracticeSetup(){
      if(setupRoute!=='ready'||!launchPlan)return;
      const content=practiceSetupContent();
      $('ready-list-names').replaceChildren(...content.names.map(name=>{const li=document.createElement('li');li.textContent=name;return li;}));
      $('ready-count').textContent='本次练习 '+content.words.length+' 项';
      $('ready-edit').hidden=!!launchPlan.words||content.names.length!==1;
      $('ready-home').textContent=launchPlan.returnRoute==='review'?'返回错词复习':deviceWriteFailures.has(deviceKeys.lists)?'返回首页':'先存着，回首页';
      $('ready-start').disabled=!content.words.length;
      $('ready-error').hidden=!!content.words.length;
      $('ready-error').textContent=content.words.length?'':'当前没有可练习的词。请开启“听写关联词”，或重新选择内容。';
      // Wrong-word review is an exact set; filtering it again would drop missed variants.
      $('related-options').hidden=!!launchPlan.words;
      const order=document.querySelector('input[name="order"]:checked').value==='random'?'乱序':'顺序';
      $('ready-settings-summary').textContent=order;
      renderRelatedChoice(content.words);
      const recognition=document.querySelector('input[name="practice-mode"]:checked')?.value==='recognize';
      document.querySelector('.ready-rule').textContent=recognition?'不需要拼写。第一关选意思，第二关回想并核对；两关都通过才算掌握。记错会回到第一关。':'不会拼时，直接按 Enter。拼错先订正，之后再穿插复习两次。';
    }
    function prepareBuiltinList(name,text,derived=[]){
      const keys=[...derived].sort(),prior=deviceLists.find(row=>row.name===name&&row.text===text&&JSON.stringify([...(row.derived||[])].sort())===JSON.stringify(keys));
      const row=prior||saveNamedList(name,text,keys);
      if(row)openPracticeSetup([row.id]);
    }
    $('ready-start').addEventListener('click',()=>{
      if(!launchPlan)return;
      const content=practiceSetupContent();if(!content.words.length){refreshPracticeSetup();return;}
      state.savedReviewBase=launchPlan.words?content.words.map(w=>({...w})):null;
      if(document.querySelector('input[name="practice-mode"]:checked')?.value==='recognize'){startRecognition(content.words,content.context);return;}
      startSession(content.words,content.context);
    });
    $('ready-edit').addEventListener('click',()=>{if(launchPlan?.ids.length===1)loadNamedList(launchPlan.ids[0]);});
    $('ready-home').addEventListener('click',()=>showSetupRoute(launchPlan?.returnRoute||'lists',{focus:true}));
    for(const radio of document.querySelectorAll('input[name="practice-mode"]'))radio.addEventListener('change',()=>{
      if(!radio.checked)return;if(radio.value!=='recognize'){$('preview-meaning').checked=radio.value==='learn';$('preview-meaning').dispatchEvent(new Event('change'));}refreshPracticeSetup();
    });
    window.addEventListener('speakey-related-change',refreshPracticeSetup);
    for(const radio of document.querySelectorAll('input[name="order"]'))radio.addEventListener('change',refreshPracticeSetup);
    $('nav-lists').addEventListener('click',()=>showSetupRoute('lists'));
    $('nav-review').addEventListener('click',()=>showSetupRoute('review'));
    $('prepare-back').addEventListener('click',()=>showSetupRoute(setupRoute==='ready'?(launchPlan?.returnRoute||'lists'):'lists',{focus:true}));
    $('draft-open').addEventListener('click',()=>showPreparation('paste',{focus:true}));
    for(const source of ['paste','file','builtin']){
      $('choose-'+source).addEventListener('click',()=>showPreparation(source));
      $('empty-'+source).addEventListener('click',()=>showPreparation(source,{fresh:true,focus:true}));
    }
    // Arrow navigation for the two task tabs and the three source choices.
    for(const ids of [['nav-lists','nav-review'],['choose-paste','choose-file','choose-builtin']])for(const id of ids){
      $(id).addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const i=ids.indexOf(id),next=event.key==='Home'?0:event.key==='End'?ids.length-1:(i+(event.key==='ArrowRight'?1:-1)+ids.length)%ids.length;
        $(ids[next]).click();$(ids[next]).focus();
      });
    }
    showPreparation('paste');showSetupRoute('lists');

    // A mistaken submission can be undone before moving on to another word.
    function captureSubmission(){
      const entry=state.words[state.index],ui=sessionUI();
      if(ui.feedback)ui.feedback={...ui.feedback,entryId:ui.feedback.entry.id,entry:undefined};
      return {roundId:state.roundId,index:state.index,entryId:entry.id,
        item:Object.fromEntries(['seen','needsReview','streak','mastered','firstCorrect','revision'].map(key=>[key,entry[key]])),
        queue:state.words.map(w=>w.id),first:state.first,errors:[...state.errors],ui};
    }
    function canUndoSubmission(){
      const saved=state.submissionUndo,entry=state.words[state.index];
      return !!saved&&state.view==='practice'&&!state.browse&&saved.roundId===state.roundId&&saved.index===state.index&&saved.entryId===entry?.id&&saved.expectedRevision===entry.revision&&saved.ui&&saved.item&&Array.isArray(saved.queue)&&saved.queue.every(id=>state.items[id]?.id===id);
    }
    function syncSubmissionUndo(){
      const button=$('undo-submission');if(!button)return;
      const available=canUndoSubmission();button.hidden=!available;
      if(available)$('empty-answer-hint').hidden=true;
    }
    function undoSubmission(){
      if(!canUndoSubmission())return;
      const saved=state.submissionUndo,entry=state.items[saved.entryId];
      // Retain a correction the learner has already begun typing.
      const draft=state.phase==='retry'&&saved.editedAfterSubmit?$('answer').value:null;
      stopSpeech();holdPracticeHeight();Object.assign(entry,saved.item);
      state.words=saved.queue.map(id=>state.items[id]);state.first=saved.first;state.errors=new Set(saved.errors);
      const ui={...saved.ui};if(draft!==null)ui.answer=draft;
      if(ui.feedback)ui.feedback={...ui.feedback,entry:state.items[ui.feedback.entryId]};
      state.submissionUndo=null;state.browse=ui;resumeProgress();syncSubmissionUndo();persistMistakes();saveDeviceSession();
      $('submission-status').textContent='已撤销本次提交，回到提交前的作答状态。';
    }
    $('undo-submission').addEventListener('click',undoSubmission);
    $('answer').addEventListener('input',()=>{if(canUndoSubmission())state.submissionUndo.editedAfterSubmit=true;});
    // A double click is one intention; its second click must not advance or re-submit.
    $('check').addEventListener('click',event=>{if(event.detail>1)event.preventDefault();});
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||!canUndoSubmission())return;
      const target=event.target;if(target.isContentEditable||target.matches('textarea,select')||(target.matches('input')&&target.id!=='answer'))return;
      event.preventDefault();if(!event.repeat)undoSubmission();
    });

    // Recognition has its own two-stage state; it never awards spelling mastery.
    const recognitionPanel=document.createElement('section');
    recognitionPanel.id='recognition';recognitionPanel.hidden=true;
    recognitionPanel.setAttribute('aria-labelledby','recognition-word');
    recognitionPanel.innerHTML=`<div class="session-top"><button id="recognition-back" class="text-button" type="button">暂停并返回词表</button><p id="recognition-progress" class="word-index" role="status"></p></div>
      <div id="recognition-bar" class="progress" role="progressbar" aria-label="认词掌握进度" aria-valuemin="0" aria-valuemax="100"><div></div></div>
      <div class="panel recognition-card">
        <p id="recognition-stage" class="recognition-stage"></p>
        <h1 id="recognition-word" lang="en" tabindex="-1"></h1>
        <div id="recognition-audio"><button id="recognition-replay" class="play" type="button" aria-label="朗读当前词"></button><button id="recognition-alternate" class="text-button alternate-voice" type="button">换声重听</button><p id="recognition-speech" class="play-caption" role="status"></p></div>
        <p id="recognition-prompt"></p>
        <div id="recognition-options" class="recognition-options"></div>
        <div id="recognition-self" class="recognition-actions" hidden><button id="recognition-unknown" type="button" class="secondary">不认识</button><button id="recognition-know" type="button" class="primary">认识，核对意思</button></div>
        <div id="recognition-feedback" class="recognition-feedback" role="status" hidden><strong id="recognition-verdict"></strong><p id="recognition-meaning"></p><p id="recognition-usage" class="hint"></p></div>
        <div id="recognition-confirm" class="recognition-actions" hidden><button id="recognition-wrong" type="button" class="secondary">记错了 ↓</button><button id="recognition-right" type="button" class="primary">意思一致，通过</button></div>
        <div id="recognition-missing" hidden><p>这个词还缺少中文释义，请补充后继续；不会把它直接算作掌握。</p><label for="recognition-definition">中文释义</label><input id="recognition-definition" class="list-name" autocomplete="off" placeholder="输入这个词在词表中的意思"><div class="recognition-actions"><button id="recognition-query" class="secondary" type="button">重试查询</button><button id="recognition-save-meaning" class="primary" type="button">使用此释义</button></div></div>
        <button id="recognition-next" class="primary" type="button" hidden>继续 →</button>
        <div class="recognition-tools"><button id="recognition-undo" class="text-button" type="button" hidden>撤销这次操作 Esc</button><button id="recognition-ambiguous" class="text-button" type="button" hidden>选项有歧义，换一组</button></div>
        <div id="recognition-notice" class="notice" role="status" hidden></div><p id="recognition-save-warning" class="notice" role="alert" hidden>设备保存失败，请保持本页打开，以免丢失进度。</p>
        <p class="recognition-keyboard hint">1–4 选择意思　R 重听　↓ 不认识或记错了　Esc 撤销</p>
      </div>`;
    $('result').after(recognitionPanel);
    $('recognition-replay').innerHTML=$('replay').innerHTML;
    // Known, concrete meanings provide alternatives even for a one-word list.
    const recognitionDistractors=[['apple','苹果'],['mountain','山峰'],['bicycle','自行车'],['hospital','医院'],['rain','雨'],['kitchen','厨房'],['elephant','大象'],['ticket','票'],['river','河流'],['teacher','教师'],['window','窗户'],['bread','面包'],['moon','月亮'],['airport','机场'],['garden','花园'],['umbrella','雨伞'],['cheese','奶酪'],['wallet','钱包'],['ocean','海洋'],['knife','刀'],['island','岛屿'],['sugar','糖'],['piano','钢琴'],['butterfly','蝴蝶'],['shoulder','肩膀'],['snow','雪'],['bridge','桥梁'],['chair','椅子'],['train','火车'],['clock','钟表'],['medicine','药物'],['newspaper','报纸'],['forest','森林'],['shoes','鞋'],['camera','照相机'],['finger','手指'],['salt','盐'],['horse','马'],['roof','屋顶'],['beach','海滩']];
    function recognitionShuffle(values){const a=values.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
    function recognitionText(text){return String(text||'').replace(/\s+/g,' ').trim();}
    function recognitionGlosses(text){return recognitionText(text).replace(/\b(?:n|v|vt|vi|adj|adv|prep|pron|conj)\./g,'').split(/[;；,，/\n]/).map(t=>t.replace(/[^\u3400-\u9fff]/g,'')).filter(Boolean);}
    function recognitionChoices(entry){
      const r=state.recognition,excluded=[entry,...state.items.filter(w=>w.groupId!==undefined&&w.groupId===entry.groupId)];
      const known=excluded.flatMap(w=>[w.chinese,localDictionary[normalize(w.english)]||'']).join(' ');
      const forbidden=new Set(recognitionGlosses(known).join(''));
      // Reject shared senses, synonyms in the same family, and repeated meanings.
      const fromList=state.items.filter(w=>!excluded.includes(w)&&applyKnownMeaning(w)).map(w=>[w.english,w.chinese]);
      const unique=new Set(),pool=[...recognitionShuffle(fromList),...recognitionShuffle(recognitionDistractors)].filter(([english,chinese])=>{
        const key=recognitionGlosses(chinese).join(''),senses=recognitionGlosses(chinese+' '+(localDictionary[normalize(english)]||'')).join('');
        if(!key||unique.has(key)||normalize(english)===normalize(entry.english)||[...senses].some(c=>forbidden.has(c)))return false;
        unique.add(key);return true;
      });
      const avoid=new Set(r.choices?.filter(c=>!c.correct).map(c=>c.text)||[]);
      const alternatives=[...pool.filter(x=>!avoid.has(x[1])),...pool.filter(x=>avoid.has(x[1]))].slice(0,3);
      if(alternatives.length!==3)return null;
      return recognitionShuffle([{text:recognitionText(entry.chinese),correct:true},...alternatives.map(x=>({text:x[1],correct:false}))]);
    }
    function validRecognitionSession(record){
      const r=record.recognition;
      return !!r&&r.version===1&&Array.isArray(r.tasks)&&r.tasks.length>0&&r.tasks.every(t=>Number.isInteger(t.id)&&record.items[t.id]&&[1,2].includes(t.stage))&&['question','reveal','feedback','missing'].includes(r.phase)&&Array.isArray(record.errors);
    }
    function startRecognition(words,context){
      saveDeviceSession();persistMistakes();cancelLookup();stopSpeech();
      state.items=words.map((w,id)=>({...w,id,stageOne:false,mastered:false}));
      const ids=state.items.map(w=>w.id),ordered=document.querySelector('input[name="order"]:checked').value==='random'?recognitionShuffle(ids):ids;
      state.recognition={version:1,tasks:ordered.map(id=>({id,stage:1})),phase:'question',choices:null,undo:null};
      state.roundId=deviceId();state.roundCreated=Date.now();state.roundComplete=false;state.libraryContext={...context,mode:'recognition'};state.returnRoute=context.returnRoute||'lists';
      state.errors=new Set();state.browse=null;state.submissionUndo=null;state.first=0;state.feedback=null;
      setView('recognition');recognitionRender({speak:true});
    }
    function saveRecognitionSession(){
      if(!state.recognition||deviceRestoring)return;
      const r=state.recognition;
      if(r.phase==='complete'){
        storeDeviceRow('sessions',{id:state.roundId},true);
        for(const id of state.libraryContext?.listIds||[]){const row=deviceLists.find(w=>w.id===id);if(row&&row.updated===state.libraryContext.versions?.[id])storeDeviceRow('lists',{...row,recognitionCompleted:Date.now()});}
      }else storeDeviceRow('sessions',JSON.parse(JSON.stringify({id:state.roundId,created:state.roundCreated,updated:Date.now(),context:state.libraryContext,items:state.items,errors:[...state.errors],recognition:r})));
      $('recognition-save-warning').hidden=!deviceWriteFailures.size;renderDeviceLibrary();
    }
    function restoreRecognitionSession(record){
      cancelLookup();stopSpeech();state.recognition=record.recognition;state.items=record.items;state.errors=new Set(record.errors);state.roundId=record.id;state.roundCreated=record.created;state.roundComplete=false;state.libraryContext=record.context;state.returnRoute=record.context?.returnRoute||'lists';state.browse=null;state.feedback=null;state.submissionUndo=null;
      setView('recognition');recognitionRender({speak:true});
    }
    function recognitionSnapshot(){
      const r=state.recognition;
      r.undo=JSON.parse(JSON.stringify({tasks:r.tasks,phase:r.phase,choices:r.choices,selected:r.selected,verdict:r.verdict,items:state.items.map(w=>({stageOne:w.stageOne,mastered:w.mastered})),errors:[...state.errors]}));
    }
    function recognitionUndo(){
      const r=state.recognition;if(!r?.undo)return;
      const saved=r.undo;state.items.forEach((w,i)=>Object.assign(w,saved.items[i]));state.errors=new Set(saved.errors);
      Object.assign(r,saved,{undo:null});delete r.items;delete r.errors;recognitionRender();persistMistakes();
    }
    function recognitionChoose(index){
      const r=state.recognition;if(r?.phase!=='question'||r.tasks[0].stage!==1||!r.choices?.[index])return;
      recognitionSnapshot();r.selected=index;
      const entry=state.items[r.tasks[0].id];
      if(r.choices[index].correct){entry.stageOne=true;r.verdict='第一关通过，稍后进入第二关。';}
      else{entry.stageOne=false;entry.mastered=false;state.errors.add(entry.id);r.verdict='这次选错了，记住意思后再试。';}
      r.phase='feedback';recognitionRender();persistMistakes();
    }
    function recognitionKnow(){const r=state.recognition;if(r?.phase!=='question'||r.tasks[0].stage!==2)return;recognitionSnapshot();r.phase='reveal';r.verdict='和你刚才想的意思一致吗？';recognitionRender();}
    function recognitionJudge(correct){
      const r=state.recognition;if(!r||!(r.phase==='reveal'||(r.phase==='question'&&r.tasks[0].stage===2&&!correct)))return;
      recognitionSnapshot();const entry=state.items[r.tasks[0].id];
      if(correct&&entry.stageOne){entry.mastered=true;r.verdict='两关都已通过，这个词已掌握。';}
      else{entry.stageOne=false;entry.mastered=false;state.errors.add(entry.id);r.verdict='已放回生词，稍后从第一关重新练习。';}
      r.phase='feedback';recognitionRender();persistMistakes();
    }
    function recognitionNext(){
      const r=state.recognition;if(r?.phase!=='feedback')return;
      stopSpeech();const task=r.tasks.shift(),entry=state.items[task.id];
      if(!entry.mastered)r.tasks.push({id:entry.id,stage:entry.stageOne?2:1});
      r.phase=r.tasks.length?'question':'complete';r.choices=null;r.undo=null;r.selected=null;r.verdict='';
      state.roundComplete=r.phase==='complete';recognitionRender({speak:true});persistMistakes();
    }
    let recognitionRenderToken=0;
    function recognitionRender({speak=false}={}){
      const token=++recognitionRenderToken,r=state.recognition;if(!r||state.view!=='recognition')return;
      const complete=r.phase==='complete',task=r.tasks[0],entry=task?state.items[task.id]:null;
      state.words=task?r.tasks.map(t=>state.items[t.id]):[];state.index=0;state.phase='recognition';
      const passed=state.items.filter(w=>w.mastered).length,percent=Math.round(passed/state.items.length*100);
      $('recognition-progress').textContent='已掌握 '+passed+' / '+state.items.length;
      $('recognition-bar').setAttribute('aria-valuenow',percent);$('recognition-bar').firstElementChild.style.width=percent+'%';
      $('recognition-stage').textContent=complete?'认词完成':task.stage===1?'第一关　选择意思':'第二关　回想意思';
      $('recognition-word').textContent=complete?'本轮全部掌握':entry.english;
      $('recognition-audio').hidden=complete;
      for(const id of ['options','self','confirm','missing','feedback','next','undo','ambiguous'])$('recognition-'+id).hidden=true;
      $('recognition-options').replaceChildren();
      if(complete){$('recognition-prompt').textContent='每个词都已通过选义与回想两关。'+(state.errors.size?'本轮错过的词已保留在“错词复习”。':'');saveRecognitionSession();return;}
      if(!applyKnownMeaning(entry)||!hasChinese(entry.chinese)){
        r.phase='missing';$('recognition-prompt').textContent='正在补充中文释义…';$('recognition-missing').hidden=false;
        $('recognition-save-meaning').disabled=false;
        if(!entry.chinese)getMeaning(entry,{priority:true}).then(()=>{if(token!==recognitionRenderToken||state.view!=='recognition')return;r.phase='question';recognitionRender();}).catch(()=>{if(token===recognitionRenderToken)$('recognition-prompt').textContent='暂时没有查到这个词的中文。';});
      }else{
        if(r.phase==='missing')r.phase='question';
        const question=r.phase==='question';
        $('recognition-prompt').textContent=question?(task.stage===1?'选择这个词在词表中的意思':'先在心里想好中文意思，再选择是否认识。'):r.phase==='reveal'?'先核对，再确认是否通过。':'看完后继续，或撤销刚才的操作。';
        if(task.stage===1){
          if(!r.choices)r.choices=recognitionChoices(entry);
          if(r.choices){
            $('recognition-options').hidden=false;
            r.choices.forEach((choice,i)=>{const b=document.createElement('button');b.type='button';b.className='recognition-option';const key=document.createElement('span'),text=document.createElement('span');key.className='recognition-option-key';key.textContent=String(i+1);text.textContent=choice.text;b.append(key,text);b.disabled=!question;b.setAttribute('aria-label',(i+1)+' '+choice.text);if(!question&&choice.correct)b.classList.add('is-correct');if(!question&&r.selected===i&&!choice.correct)b.classList.add('is-wrong');b.onclick=()=>recognitionChoose(i);$('recognition-options').append(b);});
            $('recognition-ambiguous').hidden=!question;
          }else{$('recognition-prompt').textContent='这条释义过长，无法组成可靠的四个选项。请先暂停，编辑为准确简短的中文意思。';}
        }else $('recognition-self').hidden=!question;
        const revealed=['reveal','feedback'].includes(r.phase);
        $('recognition-feedback').hidden=!revealed;
        $('recognition-verdict').textContent=revealed?r.verdict:'';
        $('recognition-meaning').textContent=revealed?entry.chinese:'';
        $('recognition-usage').textContent=revealed?(entry.usage||''):'';
        $('recognition-confirm').hidden=r.phase!=='reveal';$('recognition-next').hidden=r.phase!=='feedback';$('recognition-undo').hidden=!r.undo;
      }
      saveRecognitionSession();
      if(speak){$('recognition-speech').textContent='';$('recognition-notice').hidden=true;$('recognition-word').focus({preventScroll:true});sayCurrent();}
    }
    $('recognition-back').onclick=()=>{stopSpeech();cancelLookup();recognitionRenderToken++;saveDeviceSession();persistMistakes();setView('setup');showSetupRoute(state.returnRoute||'lists',{focus:true});};
    $('recognition-replay').onclick=()=>sayCurrent();$('recognition-alternate').onclick=()=>sayCurrent({alternate:true});
    $('recognition-know').onclick=recognitionKnow;$('recognition-unknown').onclick=()=>recognitionJudge(false);$('recognition-wrong').onclick=()=>recognitionJudge(false);$('recognition-right').onclick=()=>recognitionJudge(true);$('recognition-next').onclick=recognitionNext;$('recognition-undo').onclick=recognitionUndo;
    $('recognition-ambiguous').onclick=()=>{const r=state.recognition;r.choices=recognitionChoices(state.items[r.tasks[0].id]);recognitionRender();};
    $('recognition-query').onclick=async()=>{const r=state.recognition,entry=state.items[r.tasks[0].id],round=state.roundId,current=()=>state.roundId===round&&state.view==='recognition'&&state.items[state.recognition.tasks[0]?.id]===entry;try{await getMeaning(entry,{priority:true,retry:true});if(current())recognitionRender();}catch{if(current())$('recognition-prompt').textContent='查询未成功，可以在下面手动补充中文。';}};
    $('recognition-save-meaning').onclick=()=>{const value=recognitionText($('recognition-definition').value);if(!hasChinese(value)){$('recognition-prompt').textContent='请填写中文释义。';return;}const r=state.recognition;Object.assign(state.items[r.tasks[0].id],{chinese:value,meaningSource:'provided'});$('recognition-definition').value='';r.phase='question';recognitionRender();};
    // Separate deliberate steps; Enter never silently confirms remembered meaning.
    recognitionPanel.addEventListener('click',event=>{if(event.detail>1){event.preventDefault();event.stopImmediatePropagation();}},true);
    document.addEventListener('keydown',event=>{
      if(state.view!=='recognition'||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.target.matches('input,textarea,select')||event.target.isContentEditable)return;
      const r=state.recognition,key=event.key;
      if(!['1','2','3','4','r','R','ArrowDown','Escape','Enter'].includes(key))return;
      if(key==='Enter'&&event.target.matches('button')){if(event.repeat)event.preventDefault();return;}
      event.preventDefault();if(event.repeat)return;
      if(key==='Escape')recognitionUndo();else if(key.toLowerCase()==='r')sayCurrent();else if(key==='ArrowDown')recognitionJudge(false);else if(/^[1-4]$/.test(key))recognitionChoose(Number(key)-1);else if(key==='Enter'&&r.phase==='feedback')recognitionNext();
    });

window.addEventListener('pagehide',()=>{cancelLookup();stopSpeech();});
    if(hasSpeech)synth.getVoices();updateCount();

/* Layout-aware vocabulary extraction. Pure functions shared by PDF text and OCR import. */
(function(root){
  'use strict';
  const han=/[\u3400-\u9fff]/;
  const pos='(?:adj|adv|vt|vi|pron|prep|conj|interj|num|det|aux|modal|abbr|art|phr|pl|sing|n|v)';
  const posEnd=new RegExp('(?:^|\\s)'+pos+'\\s*\\.\\s*$','i');
  const posAny=new RegExp('(^|[^A-Za-z])'+pos+'\\s*\\.\\s*','gi');
  const aliases={
    index:/^(?:序号|编号|序|no\.?|number)$/i,
    frequency:/^(?:词频|频次|频率|frequency|freq\.?)$/i,
    word:/^(?:单词|词汇|词组|英文|英语|英文单词|word|words|vocabulary|expression|phrase)$/i,
    phonetic:/^(?:音标|读音|发音|ipa|phonetics?|pronunciation)$/i,
    pos:/^(?:词性|partofspeech|pos\.?)$/i,
    meaning:/^(?:中文|释义|词义|词性与释义|词性及释义|中文释义|中文意思|meaning|meanings|definition|translation)$/i,
    derived:/^(?:派生词?|衍生词?|derivatives?|derivation|wordfamily)$/i,
    synonym:/^(?:同义词|同义替换|替换表达|synonyms?)$/i,
    example:/^(?:例句|例子|examples?|sentences?)$/i,
    note:/^(?:备注|注释|notes?)$/i
  };
  const kind=text=>Object.keys(aliases).find(k=>aliases[k].test(text.replace(/\s/g,'').trim()));
  const isFooter=text=>/^(?:page\s*\d+(?:\s*(?:of|[/／])\s*\d+)?|第?\s*\d+\s*页(?:\s*[/／]\s*\d+\s*页?)?|\d+\s*[/／]\s*\d+|\d+)$/i.test(text.trim());
  function phonetics(text){
    return text.replace(/(^|[\s(（])[\/／]([^\/／\n]{1,110})[\/／]/g,(all,before,inside)=>!han.test(inside)&&/[A-Za-z\u0250-\u02ffæðθŋœ]/.test(inside)?before+' ':all)
      .replace(/[\[［]([^\]］\n]+)[\]］]/g,(all,inside)=>/[\u0250-\u02ffˈˌːæðθŋœ]/.test(inside)?' ':all);
  }
  function meaning(text){
    let s=phonetics(text).replace(/\b(v\s+[it]|ad\s+[jv])\s*\./gi,x=>x.replace(/\s/g,''));
    s=s.replace(new RegExp('([\\u3400-\\u9fff）)])\\s*'+pos+'\\s*\\.','gi'),'$1；');
    s=s.replace(posAny,'$1').replace(/\[(?:[CU]|sing\.?|pl\.?)\]/gi,'').trim();
    return s.replace(/\s+([,，;；。])/g,'$1').replace(/^[\s;；,，:：]+|[\s;；]+$/g,'').trim();
  }
  function head(text){
    return phonetics(text).replace(posEnd,'').replace(/^[•·●▪\s]+/,'').replace(/\s+/g,' ').trim();
  }
  function safeEnglish(text){return /[a-z]/i.test(text) && !han.test(text) && !/[\u0250-\u02ff\u0370-\u03ff]/.test(text) && !/^(?:page\s*\d+|(?:unit|chapter|lesson)\s+\d+)$/i.test(text) && /^[A-Za-z0-9'’&()\-.,/+\s]+$/.test(text);}
  function paired(text){
    const s=phonetics(text).trim(),at=s.search(han);
    if(at<0){const english=head(s);return safeEnglish(english)?{english,chinese:''}:null;}
    const opening=s.slice(0,at).match(/[（(【\[]\s*$/),boundary=opening?at-opening[0].length:at;
    const english=head(s.slice(0,boundary)),chinese=meaning(s.slice(boundary));
    return safeEnglish(english)?{english,chinese}:null;
  }
  // A row of related headwords is not a spoken phrase. Only infer a space-only
  // list when three or more dictionary words have shared lexical evidence;
  // real phrases and grammatical words are deliberately left intact.
  function relatedEntries(entry,lookup){
    if(!lookup||lookup(entry.english.toLowerCase()))return null;
    // Resolve regular inflections only for lexical evidence. Keep the user's
    // original spelling as the target (circles must not become circle).
    const lexical=word=>{
      const key=word.toLowerCase(),exact=lookup(key);if(exact)return exact;
      const bases=[];
      if(/ies$/.test(key))bases.push(key.slice(0,-3)+'y');
      if(/(?:ches|shes|xes|zes|sses|oes)$/.test(key))bases.push(key.slice(0,-2));
      if(/[^s]s$/.test(key))bases.push(key.slice(0,-1));
      return bases.map(base=>lookup(base)).find(Boolean)||'';
    };
    const functional=/^(?:a|an|the|and|or|nor|but|of|for|to|in|on|at|by|with|from|as|is|are|be|not|no|my|your|his|her|its|our|their)$/i;
    const explicit=/[,，、;；/／]/.test(entry.english);
    const parts=entry.english.split(explicit?/\s*[,，、;；/／]\s*/:/\s+/).map(s=>s.trim());
    if(parts.length<(explicit?2:3)||parts.length>6||!parts.every(s=>safeEnglish(s)&&/[a-z]{2}/i.test(s)))return null;
    if(new Set(parts.map(s=>s.toLowerCase())).size!==parts.length)return null;
    if(explicit){
      // Keep connective/measurement notation (and/or, km/h, etc.) together.
      if(parts.some(s=>functional.test(s))||parts.every(s=>/^(?:km|cm|mm|kg|mg|ms|hr|sec|min|mph)$/i.test(s)))return null;
    }else if(parts.some(s=>!/^[A-Za-z'-]{3,}$/.test(s)||functional.test(s)||!lexical(s)))return null;
    const senses=parts.map(word=>String(lexical(word)).split('\n').filter(s=>!/^\s*\[/.test(s)).slice(0,3).join(',')
      .split(/[,，;；]/).map(s=>s.replace(/^[^\u3400-\u9fff]*/,'').trim()).filter(s=>han.test(s)&&s.length<=48));
    const grams=senses.map(list=>new Set(list.flatMap(s=>(s.match(/[\u3400-\u9fff]+/g)||[]).flatMap(run=>Array.from({length:Math.max(0,run.length-1)},(_,i)=>run.slice(i,i+2))))));
    const shared=[...grams[0]].filter(g=>grams.every(set=>set.has(g)));
    const hint=(entry.chinese.match(/[\u3400-\u9fff]/g)||[]).filter(c=>!/[的地得人者性物有是一不之和与在]/.test(c));
    const commonHint=hint.filter(c=>senses.every(list=>list.some(s=>s.includes(c))));
    if(!explicit&&!shared.length&&!(hint.length<=4&&commonHint.length))return null;
    return parts.map((english,i)=>{
      const relevant=senses[i].filter(s=>shared.some(g=>s.includes(g))||hint.some(c=>s.includes(c)));
      return {english,chinese:[...new Set(relevant.length?relevant:senses[i])].slice(0,3).join('；')};
    });
  }
  function expandRelated(result,lookup){
    const convert=text=>{
      if(/[=＝]/.test(text))return text;
      const fields=text.match(/^([^\t]+)\t(.*)$/),entry=fields?{english:fields[1].trim(),chinese:fields[2].trim()}:paired(text);
      const members=entry&&relatedEntries(entry,lookup);
      return members?members.map(e=>e.english+' \t '+e.chinese).join(' = '):text;
    };
    return {...result,lines:result.lines.map(convert),mainLines:(result.mainLines||result.lines).map(convert),derivedLines:(result.derivedLines||[]).map(convert)};
  }
  function line(entry){return entry.english+(entry.chinese?(!han.test(entry.chinese[0])?' \t ':' ')+entry.chinese:'');}
  function record(result,text,derived=false){result.lines.push(text);result[derived?'derivedLines':'mainLines'].push(text);}
  function spaced(parts){
    let text='',previous=null;
    for(const p of parts.slice().sort((a,b)=>a.x-b.x)){
      const gap=previous?p.x-previous.x-previous.width:0;
      const label=previous && /[A-Za-z]$/.test(text) && new RegExp('^'+pos+'\\.').test(p.text);
      const separator=previous && (label||gap>Math.min(previous.height,p.height)*.16) && !/\s$/.test(text) && !/^\s/.test(p.text);
      text+=(separator?' ':'')+p.text;previous=p;
    }
    return text.replace(/\u00ad/g,'').trim();
  }
  function rowsFor(pieces){
    const rows=[];
    for(const p of pieces.filter(p=>p.text.trim()&&!p.vertical).sort((a,b)=>a.y-b.y||a.x-b.x)){
      let row=rows.find(r=>Math.abs(r.y-p.y)<Math.min(r.height,p.height)*.5);
      if(!row){row={y:p.y,height:p.height,parts:[]};rows.push(row);}
      row.parts.push(p);row.height=Math.max(row.height,p.height);
    }
    for(const r of rows)r.parts.sort((a,b)=>a.x-b.x);
    return rows.sort((a,b)=>a.y-b.y);
  }
  function headerLabels(parts){
    const labels=[];
    for(let i=0;i<parts.length;i++){
      let joined='',found=null;
      for(let j=i;j<Math.min(i+8,parts.length);j++){
        if(j>i&&parts[j].x-parts[j-1].x-parts[j-1].width>parts[j].height*1.2)break;
        joined+=parts[j].text.trim();
        const k=kind(joined);if(k)found={kind:k,x:parts[i].x,width:parts[j].x+parts[j].width-parts[i].x,height:parts[i].height,end:j};
      }
      if(found){labels.push(found);i=found.end;}
    }
    return labels;
  }
  function ocrHead(text,known){
    let s=head(text).replace(/\s+(?:n|v|vt|vi|adj|adv)\.?\s*$/i,'');
    const m=s.match(/^(.*?)(?:adj|adv|vt|vi|n|v)\.?$/i);
    if(m && known && !known(s) && known(m[1]))s=m[1];
    return s;
  }
  function table(rows,page,options={}){
    const headers=[];
    rows.forEach((row,i)=>{
      const groups=[];let columns=[];
      for(const p of headerLabels(row.parts)){
        const k=p.kind;
        if((k==='word'||k==='index')&&columns.some(c=>c.kind===k)&&columns.some(c=>c.kind==='meaning')){groups.push(columns);columns=[];}
        columns.push({kind:k,x:p.x,width:p.width,height:p.height});
      }
      if(columns.length)groups.push(columns);
      groups.forEach((columns,g)=>{
        if(columns.some(c=>c.kind==='word')&&columns.some(c=>c.kind==='meaning'))headers.push({row,i,columns,left:columns[0].x-columns[0].height*.6,right:groups[g+1]?groups[g+1][0].x-groups[g+1][0].height*.6:Infinity});
      });
    });
    if(!headers.length)return null;
    const result={lines:[],mainLines:[],derivedLines:[],main:0,derived:0,removed:0,review:[],structured:true};
    for(let hi=0;hi<headers.length;hi++){
      const h=headers[hi],columns=h.columns.sort((a,b)=>a.x-b.x);
      const begin=h.i+1,end=(headers.find(next=>next.i>h.i)||{i:rows.length}).i;
      // Header starts mark column starts. Keep pieces whole when a glyph extends
      // across a column boundary; never reconstruct a word from clipped glyphs.
      let mainIndex=-1;
      for(let ri=begin;ri<end;ri++){
        const row=rows[ri],parts=row.parts.filter(p=>p.x>=h.left&&p.x<h.right),raw=spaced(parts);
        if(isFooter(raw)){result.removed++;continue;}
        const cells={};
        for(const p of parts){
          let col=-1;for(let c=0;c<columns.length;c++)if(p.x>=columns[c].x-columns[c].height*.6)col=c;
          if(col<0)continue;
          (cells[columns[col].kind]||(cells[columns[col].kind]=[])).push(p);
        }
        const value=k=>spaced(cells[k]||[]);
        const rawWord=value('word');
        const wordText=columns.some(c=>c.kind==='phonetic')?rawWord.replace(/\s+[\/［\[].*$/,''):rawWord;
        const english=options.ocr?ocrHead(wordText,options.known):head(wordText);
        let chinese=meaning(value('meaning'));
        if(options.ocr){
          const at=chinese.search(han);
          if(at>=0)chinese=chinese.slice(at).replace(/([\u3400-\u9fff])\s*(?:mn|na|nn|an)\s*\./gi,'$1；');else chinese='';
        }
        if(!english){
          // A wrapped definition can continue on the following line in its own column.
          if(chinese && !/[A-Za-z]/.test(chinese) && mainIndex>=0 && row.y-rows[ri-1].y<row.height*1.5){
            result.lines[mainIndex]+=chinese;
            result.mainLines[result.mainLines.length-1]+=chinese;
          }else if(/[A-Za-z]/.test(raw) && !isFooter(raw))result.review.push({page,text:raw,reason:'未找到对应英文'});
          else result.removed++;
          continue;
        }
        if(!safeEnglish(english)){
          result.review.push({page,text:raw,reason:'英文栏含不确定内容'});continue;
        }
        if(options.ocr&&options.known&&!english.split(/[\s-]+/).every(w=>/^\d+$/.test(w)||options.known(w))){
          result.review.push({page,text:raw,reason:'扫描英文不确定，未加入听写'});continue;
        }
        let main=line({english,chinese});
        const related=value('synonym');
        if(related){const entry=paired(related);if(entry)main+=' = '+line(entry);else result.review.push({page,text:related,reason:'同义表达待核对'});}
        mainIndex=result.lines.length;record(result,main);result.main++;
        if(options.ocr&&!chinese)result.review.push({page,text:english+'\n'+value('meaning'),reason:'释义未可靠识别，已保留英文'});
        const derived=value('derived');
        if(derived){
          let entries=splitEntries(derived);
          if(options.ocr){
            const at=derived.search(han),english=ocrHead(at>=0?derived.slice(0,at):derived,options.known);
            if(safeEnglish(english))entries=[{english,chinese:at>=0?meaning(derived.slice(at)):''}];
            entries=entries.filter(entry=>!options.known||entry.english.split(/[\s-]+/).every(options.known));
          }
          if(entries.length){entries.forEach(entry=>record(result,line(entry),true));result.derived+=entries.length;}
          else result.review.push({page,text:derived,reason:'派生词待核对'});
        }
      }
    }
    // Do not activate a guessed schema when it explains none of the content.
    return result.main?result:null;
  }
  function splitEntries(text){
    // A POS label separates an English headword from its meaning. Repeated
    // labels after Chinese mark a second entry, not part of the first meaning.
    const s=phonetics(text).trim();
    const re=new RegExp('(?:^|[\\u3400-\\u9fff;；,，。\\s])([A-Za-z][A-Za-z’\'\\- ]*?)\\s+('+pos+')\\s*\\.','gi');
    const starts=[];let m;
    while((m=re.exec(s)))starts.push(m.index+(m[0].length-m[0].trimStart().length)+(han.test(m[0][0])||/[;；,，。]/.test(m[0][0])?1:0));
    if(starts.length<=1){const entry=paired(s);return entry?[entry]:[];}
    return starts.map((at,i)=>paired(s.slice(at,starts[i+1]||s.length))).filter(Boolean);
  }
  function stripListNumbers(lines){
    const normalized=lines.map(s=>s.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)));
    const rows=normalized.map((s,i)=>({i,m:s.trim().match(/^(\d+)(?:[.．、。)）]\s*|\s+)(?=[A-Za-z])(.*)$/)})).filter(r=>r.m);
    const indices=new Set();
    for(let i=0;i<rows.length;i++){
      const prev=rows[i-1],r=rows[i],next=rows[i+1];
      if((prev&&Number(r.m[1])===Number(prev.m[1])+1)||(next&&Number(next.m[1])===Number(r.m[1])+1))indices.add(r.i);
    }
    const quantity=/^(?:hours?|minutes?|seconds?|days?|weeks?|months?|years?|decades?|centur(?:y|ies)|million|billion|thousand|hundred|percent|per\s+cent|met(?:er|re)s?|kilomet(?:er|re)s?|miles?|km|cm|mm|kg|grams?|dollars?|pounds?|am|pm)\b/i;
    return normalized.map((s,i)=>{const m=s.match(/^\s*\d+\s+([A-Za-z].*)$/);return m&&indices.has(i)&&!quantity.test(m[1])?m[1]:s;});
  }
  function text(lines,page=1){
    lines=stripListNumbers(lines);
    const result={lines:[],mainLines:[],derivedLines:[],main:0,derived:0,removed:0,review:[],structured:false};
    const schema=lines.some(s=>/单词|word/i.test(s)&&/音标|释义|meaning|phonetic/i.test(s));
    for(let raw of lines){
      raw=raw.replace(/\u00ad/g,'').trim();if(!raw)continue;
      if(isFooter(raw)||kind(raw)||/^(?:第[一二三四五六七八九十\d]+章|词册部分|词汇表)$/.test(raw)||(/序号|词频/.test(raw)&&/单词|音标/.test(raw))){result.removed++;continue;}
      if(/^(?:(?:例句|注释|备注|example|note)\s*[:：]|e\.g\.\s)/i.test(raw)){result.removed++;continue;}
      if(!/[A-Za-z]/.test(raw)){result.removed++;continue;}
      let s=raw;
      // Two numeric columns are list metadata; a lone number in "24 hours" is retained.
      s=s.replace(/^\s*\d+\s+\d+\s+(?=[A-Za-z])/,'');
      s=s.replace(/^\s*(?:\d+[.)、．]|\(\d+\))\s*/,'');
      if(schema)s=s.replace(/^\d+\s+(?=[A-Za-z])/,'');
      s=phonetics(s).replace(/\s+/g,' ').trim();
      // Preserve explicit synonym groups and number-bearing phrases. Each side
      // is cleaned independently so Chinese and secondary English are not lost.
      if(/[=＝]/.test(s)){
        // Parallel bilingual lists: "hand to=collect from 递给=从…收集".
        const at=s.search(han),heads=at<0?[]:s.slice(0,at).trim().split(/[=＝]/).map(head),definitions=at<0?[]:s.slice(at).split(/[=＝]/).map(meaning);
        if(heads.length>1&&heads.length===definitions.length&&heads.every(safeEnglish)&&definitions.every(s=>han.test(s)&&!/[A-Za-z]/.test(s))){record(result,heads.map((english,i)=>english+' \t '+definitions[i]).join(' = '));result.main++;continue;}
        const sides=s.split(/[=＝]/).map(p=>paired(p)).filter(Boolean);
        if(sides.length>=2){record(result,sides.map(line).join(' = '));result.main++;continue;}
        // "apple = 苹果" is a bilingual entry, not two English expressions.
        if(sides.length===1 && s.split(/[=＝]/).some(x=>han.test(x)&&!/[A-Za-z]/.test(x))){record(result,line({english:sides[0].english,chinese:meaning(s.split(/[=＝]/).slice(1).join('；'))}));result.main++;continue;}
      }
      const entries=splitEntries(s);
      if(entries.length>1){entries.forEach((entry,i)=>record(result,line(entry),i>0));result.main++;result.derived+=entries.length-1;continue;}
      const entry=paired(s);
      if(entry){record(result,line(entry));result.main++;}
      else result.review.push({page,text:raw,reason:'无法可靠区分英文与附注'});
    }
    return result;
  }
  function page(pieces,fallback,pageNumber=1){return table(rowsFor(pieces),pageNumber)||text(fallback,pageNumber);}
  function inferNumberedTable(rows,known){
    // Inverse-color table headings are sometimes omitted by OCR. Infer a schema
    // only from repeated aligned number + frequency + word + pronunciation rows.
    const numbered=rows.filter(r=>r.parts.length>=5 && /^\d{1,5}$/.test(r.parts[0].text) && /^[^A-Za-z\u3400-\u9fff]*\d{1,4}$/.test(r.parts[1].text));
    if(numbered.length<5)return null;
    const heights=numbered.map(r=>r.height).sort((a,b)=>a-b),height=heights[Math.floor(heights.length/2)];
    const clusters=[];
    for(const row of numbered){
      let prev=null;
      for(const p of row.parts){
        if(!prev || p.x-prev.x-prev.width>height*1.05){
          let cluster=clusters.find(c=>Math.abs(c.x-p.x)<height*.7);
          if(!cluster){cluster={x:p.x,values:[]};clusters.push(cluster);}cluster.values.push(p.text);
        }
        prev=p;
      }
    }
    const columns=clusters.filter(c=>c.values.length>=Math.max(3,numbered.length*.18)).sort((a,b)=>a.x-b.x);
    if(columns.length<5)return null;
    const ratio=(c,test)=>c.values.filter(s=>test.test(s)).length/c.values.length;
    if(ratio(columns[0],/^\d+$/)<.8 || ratio(columns[1],/\d/)<.8 || ratio(columns[2],/^[A-Za-z]+$/)<.7 || ratio(columns[3],/[\/ˈ'‘]/)<.45)return null;
    // A sparse derivative column may occur on only a few rows. Require short,
    // recognizable English in an aligned column well beyond the meanings.
    if(columns.length===5){
      const extra=clusters.filter(c=>c.x>columns[4].x+height*3 && c.values.length>=2 && c.values.filter(s=>{
        const word=ocrHead(s,known);return /^[A-Za-z-]+$/.test(word)&&(!known||known(word));
      }).length/c.values.length>=.5).sort((a,b)=>a.x-b.x)[0];
      if(extra)columns.push(extra);
    }
    const labels=['序号','词频','单词','音标','释义','派生'];
    return {y:numbered[0].y-height*2,height,parts:columns.slice(0,6).map((c,i)=>({text:labels[i],x:c.x,y:numbered[0].y-height*2,width:height,height}))};
  }
  function ocr(data,pageNumber=1,known){
    if(data.listeningColumns)return listeningTable(data,pageNumber,known);
    const pieces=[];
    for(const block of data.blocks||[])for(const para of block.paragraphs||[])for(const row of para.lines||[]){
      for(const word of row.words||[]){
        if(!word.text || !word.bbox)continue;
        const b=word.bbox,r=row.bbox||b;
        pieces.push({text:word.text.trim(),x:b.x0,y:r.y1,width:b.x1-b.x0,height:Math.max(8,r.y1-r.y0),confidence:word.confidence});
      }
    }
    const rows=rowsFor(pieces),inferred=inferNumberedTable(rows,known);
    const structured=table(rows,pageNumber,{ocr:true,known})||(inferred?table([inferred,...rows],pageNumber,{ocr:true,known}):null);
    if(structured)return structured;
    const result=text((data.text||'').split('\n'),pageNumber);
    // If OCR did not expose usable columns, never let unreadable phonetics or
    // unknown tail fragments silently become a spelling target.
    if(known){const previous=result.lines,derived=new Set(result.derivedLines);result.lines=[];result.mainLines=[];result.derivedLines=[];for(const raw of previous){
      const sides=raw.split(/[=＝]/).map(paired).map(s=>s&&({...s,english:ocrHead(s.english,known)}));
      if(sides.every(s=>s && s.english.split(/[\s-]+/).every(w=>/^\d+$/.test(w)||known(w))))record(result,sides.map(line).join(' = '),derived.has(raw));
      else result.review.push({page:pageNumber,text:raw,reason:'扫描英文不确定，未加入听写'});
    }result.main=result.mainLines.length;result.derived=result.derivedLines.length;}
    return result;
  }
  function scanPieces(data){
    const parts=[];
    for(const b of data.blocks||[])for(const p of b.paragraphs||[])for(const r of p.lines||[])for(const w of r.words||[]){
      if(w.text&&w.bbox){const q=w.bbox;parts.push({text:w.text,x:q.x0,y:q.y1,width:q.x1-q.x0,height:Math.max(8,q.y1-q.y0),confidence:w.confidence});}
    }return parts;
  }
  function listeningLayout(data,width,height){
    const rows=rowsFor(scanPieces(data)),anchors=[];
    for(const row of rows)for(let i=0;i<row.parts.length;i++){
      let s='';for(let j=i;j<Math.min(i+5,row.parts.length);j++){
        const p=row.parts[j];if(j>i&&p.x-row.parts[j-1].x-row.parts[j-1].width>row.height*1.4)break;
        s+=p.text.replace(/[\s|]/g,'');
        if(/^(?:名词短语|动词短语|形容词短语|动名词短语)$/.test(s))anchors.push({x:row.parts[i].x,right:p.x+p.width,y:row.y,h:row.height});
      }
    }
    const cluster=anchors.map(a=>anchors.filter(b=>Math.abs(a.x-b.x)<Math.max(a.h,b.h)*1.5)).sort((a,b)=>b.length-a.length)[0];
    if(!cluster||cluster.length<3)return null;
    const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
    const h=median(cluster.map(a=>a.h)),left=median(cluster.map(a=>a.x))-h*.65,right=median(cluster.map(a=>a.right))-h*.15;
    if(left<width*.25||right>width*.72||right-left<width*.05)return null;
    const posRows=rows.filter(r=>r.parts.some(p=>p.x>=left&&p.x<right&&(/^(?:n\.?|v\.?|vt\.?|vi\.?|adj\.?|adv\.?|日期|价格|年份|代码|名|动|词|短语)$/i.test(p.text))));
    if(posRows.length<5)return null;
    const headerLines=[];for(const b of data.blocks||[])for(const p of b.paragraphs||[])for(const r of p.lines||[])if(/中文.*释义/.test(r.text.replace(/\s/g,''))&&r.bbox.y1<cluster[0].y)headerLines.push(r);
    const headRow=headerLines.length?{y:headerLines[headerLines.length-1].bbox.y1}:null;
    let top=Math.max(0,headRow?headRow.y+h*.6:Math.min(...posRows.map(r=>r.y))-h*2.3);
    const bottom=Math.min(height,Math.max(...posRows.map(r=>r.y))+h*3);
    const starts=rows.flatMap(r=>r.parts.filter(p=>p.x<left&&p.y>=top&&p.y<bottom&&/^[A-Za-z0-9£$]/.test(p.text)).slice(0,1));
    const origin=starts.map(a=>starts.filter(b=>Math.abs(a.x-b.x)<h*.8)).sort((a,b)=>b.length-a.length)[0];
    // The first entry may have no POS label and be vertically centered beside
    // two Chinese lines. Include the area above that aligned English entry.
    if(!headRow&&origin?.length)top=Math.max(0,Math.min(top,Math.min(...origin.map(p=>p.y-p.height))-h*1.1));
    // Some books put a vertical chapter label in the outer margin. Detect that
    // column rather than cropping the same percentage off every page's text.
    const margin=scanPieces(data).filter(p=>p.x>width*.94&&p.y>=top&&p.y<=bottom);
    const marker=margin.find(p=>p.text==='第'&&margin.filter(q=>q.y>p.y&&Math.abs(q.x-p.x)<h*.3&&q.width<h*1.2).length>=3);
    const textRight=marker?Math.floor(Math.min(...margin.map(p=>p.x))-h*.28):width;
    return {wordLeft:Math.max(0,Math.floor(Math.min(...origin.map(p=>p.x))-h*.4)),left:Math.round(left),right:Math.round(right),textRight,top:Math.round(top),bottom:Math.round(bottom),h,width,height};
  }
  function listeningTable(data,page,known){
    const {layout,english,translation}=data.listeningColumns,h=layout.h;
    const result={lines:[],mainLines:[],derivedLines:[],main:0,derived:0,removed:0,review:[],structured:true};
    // Repeat the header cutoff for cached/older column scans as well.
    const headerBottom=(data.blocks||[]).flatMap(b=>b.paragraphs||[]).flatMap(p=>p.lines||[]).filter(r=>/中文.*释义/.test(r.text.replace(/\s/g,''))).reduce((y,r)=>Math.max(y,r.bbox.y1),layout.top);
    const rows=rowsFor(scanPieces(english)).filter(r=>r.y-r.height/2>headerBottom);
    // Preserve the OCR line's reading order. Chinese word boxes often overlap
    // or include a vertical rule; sorting those boxes scrambles the sentence.
    const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
    function definitions(source,filter){
      const result=[];
      for(const b of source.blocks||[])for(const p of b.paragraphs||[])for(const r of p.lines||[]){
        const words=(r.words||[]).filter(w=>w.bbox&&(!filter||(w.bbox.x0>=layout.right&&w.bbox.x0<(layout.textRight||layout.width)))).filter(w=>!/^\s*[|—_]+\s*$/.test(w.text))
          // A thin fragment of the table border is sometimes read as 上/中/1.
          .filter(w=>!(w.bbox.x0<layout.right+h*.25&&w.bbox.x1-w.bbox.x0<h*.3&&w.text.trim().length<=1));
        if(!words.length)continue;
        const text=words.map(w=>w.text).join(' ').replace(/[|]/g,'').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1').trim();
        const y=median(words.map(w=>(w.bbox.y0+w.bbox.y1)/2));
        const confidence=words.reduce((sum,w)=>sum+(w.confidence||0),0)/words.length;
        if(y>=headerBottom&&y<=layout.bottom&&han.test(text))result.push({text,y,right:Math.max(...words.map(w=>w.bbox.x1)),confidence,unreliable:confidence<50});
      }return result;
    }
    const enhanced=definitions(data.listeningColumns.enhanced||{});
    const defs=enhanced.length?enhanced:definitions(translation);
    for(const row of defs)row.readings=[{...row}];
    const candidates=[...(enhanced.length?definitions(translation):[]),...definitions(data,true),...(data.listeningColumns.retries||[]).flatMap(r=>definitions(r.data))];
    for(const candidate of candidates){
      const match=defs.slice().sort((a,b)=>Math.abs(a.y-candidate.y)-Math.abs(b.y-candidate.y))[0];
      if(match&&Math.abs(match.y-candidate.y)<h*.65)match.readings.push(candidate);
      // Large/noisy boxes in older readings must not create extra phantom lines.
      else if(!candidate.unreliable&&candidate.confidence>=65&&(!match||Math.abs(match.y-candidate.y)>h*.9))defs.push({...candidate,readings:[candidate]});
    }
    const compact=s=>s.replace(/[^A-Za-z0-9\u3400-\u9fff]/g,'');
    for(const row of defs){
      const options=row.readings.filter(r=>!r.unreliable),pool=options.length?options:row.readings;
      const score=r=>r.confidence+15*pool.filter(other=>compact(other.text)===compact(r.text)).length-(r.text.match(/[A-Za-z]/g)||[]).length*8;
      const chosen=pool.slice().sort((a,b)=>score(b)-score(a))[0];
      const uncertain=row.readings.some(r=>{const a=compact(r.text),b=compact(chosen.text);return a!==b&&!a.includes(b)&&!b.includes(a);});
      Object.assign(row,chosen,{uncertain});
    }
    defs.sort((a,b)=>a.y-b.y);
    const entries=[];
    for(const row of rows){
      const raw=spaced(row.parts).replace(/^[|“”"‘•~—_:\-\s]+/,'').trim();
      if(!raw||/^[[(']/.test(raw)||/^-?\s*\d{3}\s*-?$/.test(raw)&&row.y>layout.bottom-h)continue;
      // A bracket begins pronunciation in this schema, even if OCR lost its close bracket.
      let target=raw.split(/[\[［]/)[0].replace(/[|:;]+$/,'').trim();
      if(!target||(/^[A-Za-z]$/.test(target)&&!/^a$|^I$/.test(target)))continue;
      entries.push({raw,english:target,y:row.y-row.height/2,height:row.height});
    }
    // Match complete definition blocks in order, allowing wrapped meanings
    // above and below a centered English entry rather than stealing a line.
    const memo=new Map();
    function align(i,j){
      if(i===entries.length)return {cost:(defs.length-j)*9,groups:[]};
      const key=i+','+j;if(memo.has(key))return memo.get(key);
      let best={cost:Infinity,groups:[]};
      for(let k=0;k<=Math.min(5,defs.length-j);k++){
        const block=defs.slice(j,j+k),center=k?block.reduce((s,d)=>s+d.y,0)/k:entries[i].y;
        const cost=k?Math.pow((center-entries[i].y)/h,2)+Math.max(0,k-1)*.08:5;
        if(k&&Math.abs(center-entries[i].y)>h*2.5)continue;
        const rest=align(i+1,j+k);if(cost+rest.cost<best.cost)best={cost:cost+rest.cost,groups:[block,...rest.groups]};
      }memo.set(key,best);return best;
    }
    const groups=align(0,0).groups;
    for(let i=0;i<entries.length;i++){
      const entry=entries[i];
      const block=groups[i]||[];
      // Resolve a fused border digit only when two OCR readings have the same
      // unit/text and one agrees with the explicit number in the English field.
      const number=(entry.english.match(/^\d+(?:\.\d+)?\b/)||[])[0];
      if(number&&block[0]){
        const current=block[0],numeric=current.text.match(/^(\d+(?:\.\d+)?)(.*)$/);
        const sameUnit=numeric&&current.readings.find(r=>{const m=r.text.match(/^(\d+(?:\.\d+)?)(.*)$/);return !r.unreliable&&m&&m[1]===number&&compact(m[2])===compact(numeric[2]);});
        if(sameUnit)Object.assign(current,sameUnit);
      }
      // A bad wrapped line must never erase its reliably read neighbours.
      // A short completed meaning gets a separator; a line wrapped at the
      // column edge (or inside parentheses) continues without a false break.
      const readable=block.filter(r=>!r.unreliable);let chinese='';
      for(let j=0;j<readable.length;j++){
        const previous=readable[j-1],open=(chinese.match(/[（(]/g)||[]).length>(chinese.match(/[）)]/g)||[]).length;
        const wrap=previous&&(previous.right>(layout.textRight||layout.width)-h*1.6||/[,，;；、)）]$/.test(chinese)||open);
        chinese+=(j&&!wrap?'；':'')+readable[j].text;
      }
      chinese=meaning(chinese.replace(/[|]/g,'').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1')).replace(/\s*([，；、])\s*/g,'$1').replace(/([（(])\s+/g,'$1').replace(/\s+([）)])/g,'$1');
      if(!/[a-z]/i.test(entry.english)){result.review.push({page,text:entry.raw+(chinese?' '+chinese:''),reason:'金额、时间或纯数字，请单独核对'});continue;}
      let target=entry.english;
      // Keep real numeric expressions/codes, but reject residual pronunciation fragments.
      const original=scanPieces(data).filter(p=>p.x<layout.left&&Math.abs(p.y-p.height/2-entry.y)<h*.6).map(p=>p.text).join(' ');
      // Reconcile a one-letter OCR disagreement only when the independent
      // full-page reading supplies an exact dictionary word at the same row.
      const originalHead=(original.match(/^[^A-Za-z]*([A-Za-z]+)/)||[])[1];
      if(known&&/^[A-Za-z]+$/.test(target)&&!known(target)&&originalHead&&known(originalHead)&&target.length===originalHead.length&&[...target.toLowerCase()].filter((c,i)=>c!==originalHead.toLowerCase()[i]).length===1)target=originalHead;
      if(/\bkm\b/.test(target)&&/km[^A-Za-z\s]/.test(original)){result.review.push({page,text:original+(chinese?' '+chinese:''),reason:'单位或上标未可靠识别，请核对'});continue;}
      const valid=w=>/^\d+(?:\.\d+)?(?:st|nd|rd|th)?$/i.test(w)||/^(?=.*\d)[A-Z\d]+$/.test(w)||!known||known(w)||(/s$/i.test(w)&&known(w.slice(0,-1)))||(/ies$/i.test(w)&&known(w.slice(0,-3)+'y'))||(/^[A-Za-z]{3,}$/.test(w)&&original.split(/[^A-Za-z]+/).includes(w));
      const alternatives=target.split('/'),variants=alternatives.filter(v=>/[a-z]/i.test(v));
      if(variants.length<alternatives.length)result.review.push({page,text:entry.raw,reason:'数字写法已留待核对，英文表达保留'});
      if(!variants.every(v=>safeEnglish(v)&&v.split(/[\s-]+/).every(valid))){result.review.push({page,text:entry.raw+(chinese?' '+chinese:''),reason:'扫描英文不确定，请核对'});continue;}
      if(block.some(r=>r.unreliable))result.review.push({page,text:target+'\n'+block.map(r=>r.text).join('；'),reason:chinese?'部分中文行不清晰，已保留可靠释义，请补充核对':'中文未可靠识别，已保留英文，请补充释义'});
      else if(!han.test(chinese)){result.review.push({page,text:entry.raw,reason:'中文未可靠识别，已保留英文'});chinese='';}
      else if((groups[i]||[]).some(r=>r.uncertain))result.review.push({page,text:target+'\n'+chinese,reason:'中文扫描结果有差异，请核对释义'});
      record(result,variants.map(english=>english.trim()+' \t '+chinese).join(' = '));result.main++;
    }
    return result;
  }
  root.SpeaKeyPDFCleaner={page,text,ocr,rowsFor,table,meaning,head,paired,splitEntries,listeningLayout,relatedEntries,expandRelated,stripListNumbers};
})(typeof window==='undefined'?globalThis:window);

/* PDF import is isolated from dictation: a failed import never changes the word list. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  let serial = 0, active = null, lastFile = null, pdfEngine = null, enginePromise = null;
  let pdfDerivedKeys=new Set();
  let batch=null;
  const urls = new Map();
  function assetURL(name) {
    if (!urls.has(name)) urls.set(name, URL.createObjectURL(new Blob([SpeaKeyAssets.bytes(name)], {type:'text/javascript'})));
    return urls.get(name);
  }
  async function getPDFEngine() {
    if (pdfEngine) return pdfEngine;
    if (!enginePromise) enginePromise = (async () => {
      if(SpeaKeyAssets.ensure)await SpeaKeyAssets.ensure(['pdf-main','pdf-worker']);
      // Keep module syntax outside the dictation script, including on older browsers.
      const load = new Function('url', 'return import(url)');
      const lib = await load(assetURL('pdf-main'));
      lib.GlobalWorkerOptions.workerSrc = assetURL('pdf-worker');
      // Local file origins cannot consistently create module workers in Safari.
      // Load the supported in-process adapter directly instead of first triggering
      // a cross-origin worker error. OCR still runs in its own classic worker.
      if(!/^https?:$/.test(location.protocol))window.pdfjsWorker=await load(assetURL('pdf-worker'));
      pdfEngine = lib;
      return lib;
    })().catch(error => {enginePromise=null; throw error;});
    return enginePromise;
  }
  class EmbeddedBinaryData {
    async fetch({kind, filename}) {
      const roots={cMapUrl:'cmaps/',standardFontDataUrl:'standard_fonts/',wasmUrl:'wasm/'};
      if (!roots[kind]) throw Error('Unsupported PDF asset');
      if(SpeaKeyAssets.ensure)await SpeaKeyAssets.ensure([roots[kind]+filename]);
      return SpeaKeyAssets.bytes(roots[kind]+filename);
    }
  }
  function check(job) { if (active!==job || job.cancelled) throw new DOMException('Cancelled','AbortError'); }
  function status(job, text) { if (active===job) {if(Array.isArray(text))setInfo('pdf-status',text);else el('pdf-status').textContent=text;} }
  function busy(value) {
    el('pdf-pick').disabled=value; el('pdf-file').disabled=value;
    el('pdf-preview').disabled=value; el('pdf-apply').disabled=value;
    el('pdf-rescan').disabled=value; el('pdf-cancel').textContent=value?'取消识别':'关闭';
    el('pdf-include-related').disabled=value;
    el('word-list').readOnly=value;el('sample').disabled=value;
    el('pdf-panel').setAttribute('aria-busy',String(value));
    el('start').disabled=value || !parseWords(el('word-list').value).words.length;
  }
  async function release(job) {
    if (!job) return;
    if(job.assetsAbort)job.assetsAbort.abort();
    if(job.releasing)return job.releasing;
    job.releasing=(async()=>{
    if(job.render) {try{job.render.cancel();}catch{}}
    if(job.worker) {try{await job.worker.terminate();}catch{} job.worker=null;}
    if(job.task) {try{await job.task.destroy();}catch{} job.task=null;}
    if(job.pdfWorker) {try{job.pdfWorker.destroy();}catch{} job.pdfWorker=null;}
    if(job.pdfPort) {job.pdfPort.terminate();job.pdfPort=null;}
    if(job.ocrURL) {URL.revokeObjectURL(job.ocrURL);job.ocrURL=null;}
    })();
    return job.releasing;
  }
  function cancel(keepBatch=false) {
    const old=active;active=null;serial++;
    if(old) {old.cancelled=true;release(old);}
    el('setup').classList.remove('pdf-open');
    busy(false);el('pdf-panel').hidden=true;el('pdf-preview').value='';lastFile=null;pdfDerivedKeys.clear();
    if(!keepBatch){if(batch?.saved)showSetupRoute('lists');batch=null;}
    el('pdf-pick').focus({preventScroll:true});
  }
  function previewCount() {
    const parsed=parseWords(el('pdf-preview').value);
    renderRelatedChoice(parsed.words,'pdf-');
    el('pdf-preview-count').textContent='共 '+parsed.words.length+' 项，练习范围在下一步设置';
    el('pdf-apply').disabled=!!active || !parsed.words.length;
  }
  function readFile(file) {
    // FileReader also works in older Safari local-file contexts.
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result));
      reader.onerror=()=>reject(Error('无法读取文件，请先将 PDF 保存到设备后重试。'));
      reader.readAsArrayBuffer(file);
    });
  }
  function cleanLines(text) {
    return text.replace(/\u00ad/g,'').replace(/\r/g,'').split('\n').map(s=>s.replace(/[\t\u00a0]+/g,' ').trim())
      .filter(s=>s && !/^(?:第?\s*\d+\s*页(?:\s*[/／]\s*\d+\s*页?)?|page\s+\d+(?:\s+of\s+\d+)?|\d+\s*[/／]\s*\d+|\d+)$/i.test(s))
      .filter(s=>! /^(?:vocabulary|word list|words?|english|中文|英文|释义|单词|词汇表|同义替换)(?:\s*[：:]\s*)?$/i.test(s));
  }
  function textLines(content, viewport, lib, pageNumber) {
    const rows=[],pieces=[];
    for(const item of content.items) {
      if(!item.str || !item.str.trim()) continue;
      const t=lib.Util.transform(viewport.transform,item.transform);
      const height=Math.max(6,Math.hypot(t[2],t[3]));
      const piece={text:item.str,x:t[4],y:t[5],width:item.width*viewport.scale,height,vertical:Math.abs(t[1])>Math.abs(t[0])};
      pieces.push(piece);if(piece.vertical)continue;
      let row=rows.find(r=>Math.abs(r.y-piece.y)<Math.min(r.height,height)*.42);
      if(!row){row={y:piece.y,height,parts:[]};rows.push(row);} row.parts.push(piece);
    }
    rows.sort((a,b)=>a.y-b.y);
    const segments=[];
    for(const row of rows){
      row.parts.sort((a,b)=>a.x-b.x);
      let line=null,last=null;
      for(const p of row.parts){
        const gap=last?p.x-last.x-last.width:0;
        const numbered=/^\s*\d{1,4}\s*[.)、．]/.test(p.text);
        const split=line && /[a-z]/i.test(line.text) && (numbered || (gap>Math.max(48,p.height*4) && /^[a-z]/i.test(p.text)));
        if(!line || split){line={x:p.x,y:row.y,text:''};segments.push(line);last=null;}
        const space=last && gap>p.height*.12 && !/\s$/.test(line.text) && !/^\s/.test(p.text);
        line.text+=(space?' ':'')+p.text;last=p;
      }
    }
    // Separate numbered columns are read down each column; bilingual table cells stay together.
    const numbered=segments.filter(s=>/^\s*\d{1,4}\s*[.)、．]/.test(s.text));
    const origins=[];
    for(const s of numbered)if(!origins.some(x=>Math.abs(x-s.x)<24))origins.push(s.x);
    origins.sort((a,b)=>a-b);
    if(origins.length===2 && origins[1]-origins[0]>viewport.width*.28 && numbered.length>=4){
      const mid=(origins[0]+origins[1])/2;
      segments.sort((a,b)=>(Number(a.x>mid)-Number(b.x>mid)) || a.y-b.y);
    }
    return SpeaKeyPDFCleaner.page(pieces,cleanLines(segments.map(s=>s.text).join('\n')),pageNumber);
  }
  async function getOCR(job) {
    if(job.worker)return job.worker;
    status(job,'正在准备中英文扫描识别…');
    if(SpeaKeyAssets.ensure){job.assetsAbort=new AbortController();await SpeaKeyAssets.ensure(['ocr-core','ocr-worker','ocr-eng','ocr-chi_sim'],job.assetsAbort.signal);check(job);}
    // The WASM core and both language models are bundled. No document or image leaves the device.
    job.ocrURL=URL.createObjectURL(new Blob([SpeaKeyAssets.text('ocr-core'),'\n',SpeaKeyAssets.text('ocr-worker')],{type:'text/javascript'}));
    // Adapter for the pinned Tesseract.js 7 worker protocol. The stock createWorker
    // initializer incorrectly treats an inline language's data as its name.
    // Owning the worker also makes startup cancellation immediate and settles errors.
    const native=new Worker(job.ocrURL),pending=new Map();let sequence=0,closed=false;
    function rejectAll(error){for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();}
    native.onerror=event=>rejectAll(Error(event.message||'OCR worker failed'));
    native.onmessage=event=>{
      const message=event.data;
      if(message.status==='progress'){
        if(message.data.status==='recognizing text')status(job,['正在识别第 '+job.page+' / '+job.pages+' 页',Math.round(message.data.progress*100)+'%']);
        return;
      }
      const item=pending.get(message.jobId);if(!item)return;
      pending.delete(message.jobId);clearTimeout(item.timer);
      if(message.status==='resolve')item.resolve(message.data);else item.reject(Error(String(message.data)));
    };
    function send(action,payload){
      if(closed)return Promise.reject(new DOMException('Cancelled','AbortError'));
      return new Promise((resolve,reject)=>{
        const id='speakey-'+(++sequence);
        const timer=setTimeout(()=>{pending.delete(id);reject(Error('扫描识别超时，请把 PDF 拆成较少页或降低图片分辨率后重试。'));},120000);
        pending.set(id,{resolve,reject,timer});native.postMessage({workerId:'speakey',jobId:id,action,payload});
      });
    }
    job.worker={
      async language(langs){await send('initialize',{langs,oem:1,config:{}});check(job);},
      terminate(){closed=true;native.terminate();rejectAll(new DOMException('Cancelled','AbortError'));},
      async recognize(canvas,options={}){
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob)throw Error('Cannot render PDF image');
        const image=await readFile(blob);check(job);
        return {data:await send('recognize',{image,options,output:{text:true,blocks:true}})};
      }
    };
    await send('load',{options:{lstmOnly:true,logging:false}});check(job);
    await send('loadLanguage',{langs:[
      {code:'eng',data:SpeaKeyAssets.bytes('ocr-eng')},
      {code:'chi_sim',data:SpeaKeyAssets.bytes('ocr-chi_sim')}
    ],options:{cacheMethod:'none',gzip:true,lstmOnly:true}});check(job);
    await send('initialize',{langs:'eng+chi_sim',oem:1,config:{}});check(job);
    await send('setParameters',{params:{preserve_interword_spaces:'1'}});check(job);
    return job.worker;
  }
  async function scan(page, job) {
    const worker=await getOCR(job);check(job);
    const natural=page.getViewport({scale:1});
    const scale=Math.min(3.5,2800/Math.max(natural.width,natural.height));
    const viewport=page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try {
      job.render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff'});
      await job.render.promise;job.render=null;check(job);
      const result=await worker.recognize(canvas);check(job);
      const layout=SpeaKeyPDFCleaner.listeningLayout(result.data,canvas.width,canvas.height);
      if(layout){
        status(job,'正在分栏识别第 '+job.page+' / '+job.pages+' 页…');
        const english=await worker.recognize(canvas,{rectangle:{left:layout.wordLeft,top:layout.top,width:layout.left-layout.wordLeft,height:layout.bottom-layout.top},tessedit_pageseg_mode:'6',tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 []()'.,/£$&:-²"});check(job);
        await worker.language('chi_sim');
        const translation=await worker.recognize(canvas,{rectangle:{left:layout.right,top:layout.top,width:layout.textRight-layout.right,height:layout.bottom-layout.top},tessedit_pageseg_mode:'6'});check(job);
        // Faint text from the reverse side and table rules can make an entire
        // Chinese line look like noise. Re-read a clean column independently;
        // keep the original reading too, since faint real strokes may be lost.
        status(job,'正在核对第 '+job.page+' / '+job.pages+' 页的跨行释义…');
        const cleaned=cleanChineseColumn(canvas,layout);
        let enhanced;
        const retries=[];
        try {
          enhanced=await worker.recognize(cleaned.canvas,{tessedit_pageseg_mode:'6'});check(job);
          const move=part=>{
            if(part.bbox){part.bbox.x0+=cleaned.x;part.bbox.x1+=cleaned.x;part.bbox.y0+=cleaned.y;part.bbox.y1+=cleaned.y;}
            for(const key of ['blocks','paragraphs','lines','words','symbols'])for(const child of part[key]||[])move(child);
          };
          move(enhanced.data);
          // A line that is still weak gets a close reading of the untouched
          // scan. This recovers faint strokes removed by the contrast pass.
          const lines=(enhanced.data.blocks||[]).flatMap(b=>b.paragraphs||[]).flatMap(p=>p.lines||[]);
          for(const line of lines){
            const words=(line.words||[]).filter(w=>w.bbox&&!/^\s*[|—_]+\s*$/.test(w.text));
            const confidence=words.reduce((sum,w)=>sum+(w.confidence||0),0)/Math.max(1,words.length);
            if(confidence>=65)continue;
            const box=line.bbox,pad=8,x=Math.max(layout.right,box.x0-pad),y=Math.max(layout.top,box.y0-pad);
            const w=Math.min(layout.textRight,box.x1+pad)-x,h=Math.min(layout.bottom,box.y1+pad)-y;
            if(h>layout.h*2.1||w<8||h<8)continue;
            const close=document.createElement('canvas');close.width=Math.ceil(w*2)+24;close.height=Math.ceil(h*2)+24;
            const ctx=close.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,close.width,close.height);ctx.drawImage(canvas,x,y,w,h,12,12,w*2,h*2);
            try {
              const retry=await worker.recognize(close,{tessedit_pageseg_mode:'7'});check(job);
              const map=part=>{if(part.bbox)for(const k of ['x0','x1','y0','y1'])part.bbox[k]=(part.bbox[k]-12)/2+(k[0]==='x'?x:y);for(const key of ['blocks','paragraphs','lines','words','symbols'])for(const child of part[key]||[])map(child);};
              map(retry.data);retries.push({data:retry.data,x,y});
            } finally {close.width=close.height=0;}
          }
        } finally {cleaned.canvas.width=cleaned.canvas.height=0;}
        await worker.language('eng+chi_sim');
        result.data.listeningColumns={layout,english:english.data,translation:translation.data,enhanced:enhanced.data,retries};
      }
      return SpeaKeyPDFCleaner.ocr(result.data,job.page,word=>Object.hasOwn(localDictionary,word.toLowerCase())||Object.hasOwn(importLexicon.cases,word.toLowerCase()));
    } finally {canvas.width=canvas.height=0;}
  }
  function cleanChineseColumn(source,layout){
    const padding=12,w=layout.textRight-layout.right,h=layout.bottom-layout.top;
    const canvas=document.createElement('canvas');canvas.width=w+padding*2;canvas.height=h+padding*2;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(source,layout.right,layout.top,w,h,padding,padding,w,h);
    const image=ctx.getImageData(0,0,canvas.width,canvas.height),d=image.data;
    for(let i=0;i<d.length;i+=4){const value=(d[i]*.299+d[i+1]*.587+d[i+2]*.114)<210?0:255;d[i]=d[i+1]=d[i+2]=value;}
    // Connected components also find slightly slanted/broken table rules.
    // Chinese strokes are much shorter than these tall, narrow components.
    const width=canvas.width,height=canvas.height,seen=new Uint8Array(width*height),queue=new Int32Array(width*height);
    for(let start=0;start<seen.length;start++){
      if(seen[start]||d[start*4]!==0)continue;
      let size=1,head=0,minX=start%width,maxX=minX,minY=Math.floor(start/width),maxY=minY;queue[0]=start;seen[start]=1;
      while(head<size){const at=queue[head++],x=at%width,y=Math.floor(at/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;const next=ny*width+nx;if(!seen[next]&&d[next*4]===0){seen[next]=1;queue[size++]=next;}}
      }
      if(maxY-minY>layout.h*2&&maxX-minX<layout.h*.4)for(let i=0;i<size;i++){
        const at=queue[i];for(let dx=-1;dx<=1;dx++){const pixel=(at+dx)*4;if(pixel>=0&&pixel<d.length)d[pixel]=d[pixel+1]=d[pixel+2]=255;}
      }
    }
    ctx.putImageData(image,0,0);
    return {canvas,x:layout.right-padding,y:layout.top-padding};
  }
  function explain(error) {
    if(error.name==='NetworkAssetError')return '识别组件未能下载，请检查连接后重新导入；原词表未改动。';
    if(error.name==='PasswordException')return '这份 PDF 已加密。请先用 PDF 阅读器解锁并另存后导入。';
    if(error.name==='InvalidPDFException')return '这不是可读取的 PDF，或文件已损坏。请重新保存 PDF 后再试。';
    if(error.name==='MissingPDFException')return '无法读取 PDF，请先将它保存到设备。';
    if(/memory|allocation|out of bounds/i.test(error.message||''))return '这份 PDF 超出当前设备可用内存。请拆成较少页后再导入。';
    if(/module|import|worker|wasm|webassembly|unsupported/i.test(error.message||''))return '当前浏览器无法启动 PDF 识别。请更新浏览器或换用其他浏览器；仍可直接粘贴词表听写。';
    return error.message==='LIMIT'?'PDF 目前支持不超过 50 MB、100 页，请拆分后导入。':'识别未完成，请重新导入或换一份 PDF；也可以直接粘贴词表。';
  }
  async function importPDF(file, forceScan=false) {
    if(!file || active)return;
    const job={id:++serial,cancelled:false,page:0,pages:0};active=job;lastFile=file;
    el('setup').classList.add('pdf-open');
    el('pdf-panel').hidden=false;el('pdf-preview-wrap').hidden=true;el('pdf-rescan').hidden=true;
    el('pdf-file-name').textContent=file.name;el('pdf-preview').value='';el('pdf-result-note').textContent='';
    el('pdf-list-name').value=file.name.replace(/\.(pdf|txt)$/i,'');
    const multiple=batch&&batch.files.length>1;
    el('pdf-batch-count').textContent=multiple?'第 '+(batch.index+1)+' / '+batch.files.length+' 份':'';
    el('pdf-skip').hidden=!multiple;
    el('pdf-apply').textContent=multiple&&batch.index+1<batch.files.length?'保存，核对下一份':'下一步，选择练习方式';
    pdfDerivedKeys.clear();
    el('pdf-review').hidden=true;el('pdf-review-list').textContent='';
    busy(true);status(job,'正在读取 PDF…');
    el('pdf-panel').scrollIntoView({block:'nearest'});
    try {
      if(file.size>50*1024*1024)throw Error('LIMIT');
      const data=await readFile(file);check(job);
      if(/\.txt$/i.test(file.name)){
        el('pdf-preview').value=new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/,'');
        el('pdf-preview-wrap').hidden=false;status(job,'已读取文本词表');
        el('pdf-result-note').textContent='请核对英文和中文，再保存这份词表。';return;
      }
      if(!new TextDecoder('latin1').decode(data.subarray(0,1024)).includes('%PDF-'))throw Object.assign(Error('Invalid PDF'),{name:'InvalidPDFException'});
      const lib=await getPDFEngine();check(job);
      job.task=lib.getDocument({data,BinaryDataFactory:EmbeddedBinaryData,useWorkerFetch:false,isEvalSupported:false,
        isOffscreenCanvasSupported:false,isImageDecoderSupported:false,cMapPacked:true,stopAtErrors:false});
      const doc=await job.task.promise;check(job);job.pages=doc.numPages;
      if(doc.numPages>100)throw Error('LIMIT');
      const pages=[],review=[],mainLines=[],derivedLines=[];let scanned=0,empty=0,mainCount=0,derivedCount=0,structured=0;
      for(let n=1;n<=doc.numPages;n++){
        job.page=n;status(job,'正在提取第 '+n+' / '+doc.numPages+' 页…');
        const page=await doc.getPage(n);check(job);
        let extracted={lines:[],main:0,derived:0,review:[]};
        if(!forceScan){
          const content=await page.getTextContent();check(job);
          extracted=textLines(content,page.getViewport({scale:1}),lib,n);
        }
        if(forceScan || !extracted.lines.some(line=>/[a-z]{2}/i.test(line))){extracted=await scan(page,job);scanned++;}
        extracted=SpeaKeyPDFCleaner.expandRelated(extracted,word=>localDictionary[word]);
        const lines=extracted.lines;mainCount+=extracted.main;derivedCount+=extracted.derived;review.push(...extracted.review);if(extracted.structured)structured++;
        mainLines.push(...(extracted.mainLines||lines));derivedLines.push(...(extracted.derivedLines||[]));
        if(!lines.some(line=>/[a-z]/i.test(line)))empty++;
        pages.push(lines.join('\n'));page.cleanup();check(job);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      check(job);el('pdf-preview').value=pages.filter(Boolean).join('\n\n');
      pdfDerivedKeys=derivativeKeys(mainLines,derivedLines);
      el('pdf-preview-wrap').hidden=false;el('pdf-rescan').hidden=false;
      setInfo('pdf-status',['已读取 '+job.pages+' 页'+(scanned?'（'+scanned+' 页扫描识别）':''),mainCount+' 个主词'+(derivedCount?'，'+derivedCount+' 个派生词':'')]);
      el('pdf-result-note').textContent=(empty?empty+' 页未识别到英文。':'')+(structured?'已按栏目去除序号、词频、音标、词性和页眉页码。':'已整理序号、音标和词性，保留英文与中文释义。')+'每份文件单独保存，请核对后继续。'+(scanned?'扫描识别可能有错字。':'内容缺失时可改用扫描识别。');
      if(review.length){
        el('pdf-review').hidden=false;el('pdf-review-summary').textContent=review.length+' 处需要核对';
        for(const item of review){
          const li=document.createElement('li'),page=document.createElement('span'),reason=document.createElement('strong'),excerpt=document.createElement('span');
          page.className='pdf-review-meta';page.textContent='第 '+item.page+' 页';reason.className='pdf-review-reason';reason.textContent=item.reason;excerpt.className='pdf-review-excerpt';excerpt.textContent=item.text;
          li.append(page,reason,excerpt);el('pdf-review-list').appendChild(li);
        }
      }
    } catch(error) {
      if(active===job && error.name!=='AbortError'){
        console.warn('PDF import:',error);
        el('pdf-status').textContent=explain(error);el('pdf-rescan').hidden=true;
      }
    } finally {
      await release(job);
      if(active===job){active=null;busy(false);previewCount();}
    }
  }
  function beginFiles(files){
    if(active||!files.length)return;
    batch={files:Array.from(files),index:0,saved:0,ids:[]};importPDF(batch.files[0]);
  }
  function nextFile(){
    const queue=batch;cancel(true);
    if(queue&&++queue.index<queue.files.length){batch=queue;importPDF(queue.files[queue.index]);return;}
    batch=null;
    if(queue?.ids.length)openPracticeSetup(queue.ids);else showSetupRoute('lists',{focus:true});
    if(queue)$('device-library-status').textContent=deviceWriteFailures.has(deviceKeys.lists)?'设备保存失败，已识别的词表暂存在本页。':'已保存 '+queue.saved+' 份词表。';
  }
  el('pdf-pick').addEventListener('click',()=>el('pdf-file').click());
  el('pdf-file').addEventListener('change',event=>{const files=Array.from(event.target.files);event.target.value='';beginFiles(files);});
  el('pdf-cancel').addEventListener('click',()=>cancel());
  el('pdf-skip').addEventListener('click',nextFile);
  el('pdf-preview').addEventListener('input',previewCount);
  el('pdf-include-related').addEventListener('change',event=>setRelatedPreference(event.target.checked));
  window.addEventListener('speakey-related-change',previewCount);
  el('pdf-rescan').addEventListener('click',()=>importPDF(lastFile,true));
  el('pdf-apply').addEventListener('click',()=>{
    if(active || !parseWords(el('pdf-preview').value).words.length)return;
    const incoming=el('pdf-preview').value.replace(/^[ \r\n]+|[ \r\n]+$/g,'');
    const row=saveNamedList(el('pdf-list-name').value,incoming,pdfDerivedKeys);
    if(!row)return;if(batch){batch.saved++;batch.ids.push(row.id);}
    nextFile();
  });
  let dragDepth=0;
  const setup=el('setup');
  const hasFiles=event=>event.dataTransfer && Array.from(event.dataTransfer.types||[]).includes('Files');
  setup.addEventListener('dragenter',event=>{if(hasFiles(event)){event.preventDefault();dragDepth++;setup.classList.add('pdf-dragging');}});
  setup.addEventListener('dragover',event=>{if(hasFiles(event)){event.preventDefault();event.dataTransfer.dropEffect=active?'none':'copy';}});
  setup.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;setup.classList.remove('pdf-dragging');}});
  setup.addEventListener('drop',event=>{
    if(!hasFiles(event))return;event.preventDefault();dragDepth=0;setup.classList.remove('pdf-dragging');
    if(active)return;
    beginFiles(Array.from(event.dataTransfer.files||[]));
  });
  // Do not let a dropped file navigate away and erase the current word list.
  document.addEventListener('dragover',event=>{if(hasFiles(event))event.preventDefault();});
  document.addEventListener('drop',event=>{if(hasFiles(event))event.preventDefault();});
  window.addEventListener('pagehide',()=>{if(active){active.cancelled=true;release(active);active=null;}});
  // The cleaner loads after the main app; re-count restored drafts with its rules.
  updateCount();
})();

window.speakeyReady();