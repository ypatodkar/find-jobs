// Local UI integration checks. Matching and account APIs are fixtures; no model calls.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const artifactDir = path.join(root, '.catalogue/one-click-match');
fs.mkdirSync(artifactDir, { recursive: true });
const requirements = [
  'Build and operate reliable distributed systems in production.',
  'Develop backend services and APIs using Java or Go.',
  'Collaborate with product engineers to deliver customer-facing features.',
  'Create automated tests for critical application workflows.',
  'Own the reliability of systems handling high volumes of traffic.',
  'Design data models and optimize complex SQL queries.',
  ...Array.from({length:22},(_,i)=>`Demonstrate practical experience with engineering responsibility ${i+1} and its production operations.`)
];
const findings = requirements.map((text,i)=>({text,kind:i<22?'required':'preferred',weight:i<22?1:0.4,status:i<4?'shown':i<6?'partial':'unclear',confidence:0.9,evidence:i<6?'Built and operated backend services, improved reliability and maintained automated tests.':null}));
findings[26].text = 'Experience with: Distributed architectures across multiple regions';
findings[27].text = 'Repeated requirement with ambiguous location in this posting.';
const description = `<h3>About the role</h3><p>Build the infrastructure that helps teams deliver better software. Work with a collaborative engineering team to solve customer problems.</p><h3>Responsibilities</h3><ul>${requirements.slice(0,4).map((x,i)=>`<li>${x}${i===0?' Coordinate with your team on release planning.':''}</li>`).join('')}</ul><h3>Required qualifications</h3><ul>${requirements.slice(4,26).map(x=>`<li>${x}</li>`).join('')}<li>Experience with:<ul><li>Distributed architectures across multiple regions</li></ul></li><li>${findings[27].text}</li><li>${findings[27].text}</li></ul><h3>Benefits and compensation</h3><p>Competitive compensation, health coverage, generous time off and flexible work arrangements.</p><p>Original closing content remains available.</p><img src="x" onerror="window.xss=true"><script>window.xss=true</script>`;
const result = {score:20,findings,summary:{demonstrated:6,total:28},checkedAt:Date.now(),limits:{},rubricVersion:'resume-fit-v4'};
const resumes = [{id:'r_systems',label:'Systems resume'},{id:'r_data',label:'Data resume'},{id:'r_frontend',label:'Frontend resume'}];
const jobs = Array.from({length:140},(_,i)=>({job_id:`job_${i}`,title:i===0?'Senior Software Engineer':i===1?'Senior Data Engineer':`Software Engineer, Platform ${i+1}`,company:i===0?'Telescope':i===1?'Re:Build Manufacturing':'Engineering Company',city:'New York',remote:true,roles:['backend'],firms:['a16z'],seniority:'senior',source:'ats',ats:'Greenhouse',salary:'$160,000–$210,000',salaryMin:160000,salaryMax:210000,posted:new Date(Date.now()-i*60000).toISOString(),url:'https://example.com/job',described:true}));
let mode='normal',postCalls=0,getCalls=0,postScore=20,lastPost=null;
let reviewCalls=0,lastReview=null,reviewFailure=false;
let lastResumePost=null,resumePostCalls=0,resumeDeleteCalls=0,resumeWriteError=false;
let uploadedResumes=[];
const removedResumeIds=new Set();
const reviews=new Map();
const reviewKey=(resume,job,version)=>`${resume}|${job}|${version}`;
const zeroResult={...result,findings:findings.map((f,i)=>({...f,status:i<4?'partial':'unclear',evidence:i<4?f.evidence:null})),summary:{demonstrated:4,total:28}};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(body,code=200)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/api/all-jobs.json') return json({jobs});
  if(url.pathname.startsWith('/api/desc/')) return json(mode==='no-description'?{}:Object.fromEntries(jobs.map(j=>[j.job_id,description])));
  if(url.pathname==='/api/auth/config') return json({clientId:null});
  if(url.pathname==='/api/auth/me') return json({account:mode==='signed-out'?null:{id:'fixture',name:'Test user'}});
  if(url.pathname==='/api/sync') return json({});
  if(url.pathname==='/api/resumes') {
    if(mode==='error') return json({error:'Storage temporarily unavailable.'},503);
    if(req.method==='POST') {
      resumePostCalls++;let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
        lastResumePost=JSON.parse(body);
        if(resumeWriteError)return json({error:'Resume upload temporarily unavailable.'},503);
        const uploaded={id:'r_uploaded',label:'Uploaded resume'};
        uploadedResumes=[uploaded,...uploadedResumes.filter(r=>r.id!==uploaded.id)];removedResumeIds.delete(uploaded.id);
        json({resume:uploaded});
      });return;
    }
    return json({resumes:mode==='no-resume'?uploadedResumes:[...uploadedResumes,...resumes].filter(r=>!removedResumeIds.has(r.id))});
  }
  if(url.pathname.startsWith('/api/resumes/')&&req.method==='DELETE') {
    resumeDeleteCalls++;
    if(resumeWriteError)return json({error:'Resume removal temporarily unavailable.'},503);
    const id=decodeURIComponent(url.pathname.split('/').pop());removedResumeIds.add(id);uploadedResumes=uploadedResumes.filter(r=>r.id!==id);
    return json({ok:true});
  }
  if(url.pathname==='/api/match/feedback'&&req.method==='POST') {
    reviewCalls++;let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      lastReview=JSON.parse(body);
      const feedback={rating:lastReview.rating,reviewedAt:Date.now()};
      const fail=reviewFailure;
      setTimeout(()=>{
        if(fail)return json({error:'Could not save feedback. Please try again.'},503);
        reviews.set(reviewKey(lastReview.resume_id,lastReview.job_id,lastReview.checked_at),feedback);
        json({feedback});
      },250);
    });return;
  }
  if(url.pathname==='/api/match') {
    if(req.method==='POST') {
      postCalls++;let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{lastPost=JSON.parse(body);const fail=mode==='post-error';const next={...(mode==='zero'?zeroResult:{...result,score:postScore}),checkedAt:Date.now(),feedback:null};setTimeout(()=>fail?json({error:'Matching temporarily unavailable.'},503):json(next),350);});return;
    }
    getCalls++;
    if(mode==='unanalyzed'||['r_frontend','r_uploaded'].includes(url.searchParams.get('resume'))) return json({match:null});
    const r=mode==='twenty-seven'?{...result,findings:findings.slice(0,27),summary:{demonstrated:6,total:27}}:mode==='zero'?zeroResult:url.searchParams.get('resume')==='r_data'?{...result,score:60,findings:findings.slice(0,2),summary:{demonstrated:2,total:2}}:result;
    return setTimeout(()=>json({match:{...r,feedback:reviews.get(reviewKey(url.searchParams.get('resume'),url.searchParams.get('job'),r.checkedAt))||null}}),url.searchParams.get('resume')==='r_data'?250:10);
  }
  if(url.pathname==='/featured.json') return json({});
  const file=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) {res.writeHead(404);return res.end();}
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    // The resume dropdown in the description pane: a resume's own button, and the one chosen.
    const pick=(name)=>page.locator('#detail-match .resume-picker').getByRole('button',{name,exact:true});
    const activeResume=()=>page.locator('#detail-match .resume-picker [data-act="choose"][aria-pressed="true"]').getAttribute('data-resume-id');
    page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    const waitScore=async(score)=>{await page.waitForFunction(n=>document.querySelector('.analysis-score-number')?.textContent===`${n}/100`,score);await page.getByRole('button',{name:'Reanalyze',exact:true}).waitFor();};
    const open=async()=>{
      await page.goto(base);await page.locator('.job[data-job-id="job_0"]').waitFor();
      if(page.viewportSize().width<1100&&await page.locator('#job-detail').isVisible()){
        if(await page.locator('#detail-title').textContent()==='Senior Software Engineer')return;
        await page.locator('#detail-top .detail-close').click();await page.locator('#job-detail').waitFor({state:'hidden'});
      }
      await page.locator('.job[data-job-id="job_0"]').click();
    };
    const readingMeasurements=[];
    const checkReadingLayout=async()=>{
      await page.waitForFunction(()=>!document.querySelector('#detail-body').hasAttribute('aria-busy'));
      await page.locator('.job-detail').evaluate(el=>el.scrollTop=0);
      if(page.viewportSize().width>=1100){
        await page.evaluate(()=>window.scrollTo(0,document.querySelector('#results-split').offsetTop));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      }
      const layout=await page.evaluate(()=>{
        const head=document.querySelector('.detail-head').getBoundingClientRect();
        const body=document.querySelector('#detail-body').getBoundingClientRect();
        const prose=document.querySelector('#detail-body > p').getBoundingClientRect();
        return {width:innerWidth,jd:Math.round(body.top-head.bottom),prose:Math.round(prose.top-head.bottom),font:getComputedStyle(document.querySelector('#detail-body')).fontSize};
      });
      readingMeasurements.push(layout);
      await page.screenshot({path:path.join(artifactDir,`refined-${layout.width}.png`)});
      await page.locator('.job-detail').evaluate(pane=>{
        const description=pane.querySelector('.description-controls');
        pane.scrollTop+=description.getBoundingClientRect().top-pane.getBoundingClientRect().top-pane.querySelector('.detail-head').offsetHeight-20;
      });
      await page.screenshot({path:path.join(artifactDir,`reading-${layout.width}.png`)});
      await page.locator('.job-detail').evaluate(el=>el.scrollTop=0);
      assert.equal(layout.font,'12px');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the page fits the viewport');
      assert.ok(await page.locator('.job-detail').evaluate(el=>el.scrollWidth<=el.clientWidth),'the inspector has no horizontal overflow');
      const insightText=await page.locator('.analysis-insights [data-passage]').evaluateAll(links=>links.every(el=>el.textContent.length<=113 && el.dataset.passage.toLowerCase().includes(el.textContent.replace(/…$/,'').toLowerCase())));
      assert.equal(insightText,true,'insight summaries use concise excerpts from the original requirements');
      const originalText=await page.locator('.analysis-insights li').evaluateAll(rows=>rows.every(row=>row.title===row.querySelector('[data-passage]').dataset.passage));
      assert.equal(originalText,true,'the complete original wording is still accessible');
      assert.equal(await page.locator('.analysis-header-toolbar .analysis-tools').count(),1);
      assert.equal(await page.locator('.analysis-header-toolbar').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.analysis-score-section').getBoundingClientRect().top),true,'resume controls form the analysis header');
      const insightRows=await page.locator('.analysis-insights li').evaluateAll(rows=>rows.map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,background:getComputedStyle(el).backgroundColor})));
      assert.ok(insightRows[1].top>=insightRows[0].bottom,'insights are vertically stacked');
      assert.ok(insightRows.every(row=>row.background!=='rgba(0, 0, 0, 0)'),'insight rows have subtle backgrounds');
      assert.equal(await page.locator('.insight-copy').first().evaluate(el=>getComputedStyle(el).webkitLineClamp),'none');
      const tools=await page.locator('.analysis-tools').boundingBox();
      const source=await page.locator('.analysis-source').boundingBox();
      assert.ok(source.y+source.height<=tools.y || source.x+source.width<=tools.x,'resume metadata and actions do not overlap');
      assert.equal(await page.locator('.requirement-breakdown').isVisible(),false);
      assert.ok(await page.locator('.analysis-insights > li').count()<=3);
    };
    const checkExpanded=async(name)=>{
      const region=page.getByRole('dialog',{name:'Requirement breakdown'});
      const returnScroll=await page.locator('.job-detail').evaluate(el=>el.scrollTop);
      assert.equal(await region.evaluate(el=>el.matches(':modal')),true,'the breakdown opens as a native modal');
      assert.equal(await region.getByRole('button',{name:'Close requirement breakdown',exact:true}).evaluate(el=>el===document.activeElement),true,'opening focuses the close button');
      await region.getByRole('button',{name:'Close requirement breakdown',exact:true}).press('Tab');
      assert.equal(await region.evaluate(el=>el.contains(document.activeElement)),true,'keyboard focus stays inside the modal');
      assert.equal(await region.locator('.requirement-row').count(),28,'full breakdown includes every requirement');
      assert.deepEqual((await region.locator('.requirement-row-text').allTextContents()).sort(),findings.map(f=>f.text).sort(),'all original requirement text is retained');
      assert.equal(await region.locator('.requirement-group').count(),2);
      assert.equal(await region.locator('.requirement-row[open]').count(),0,'rows start collapsed');
      assert.equal(await region.locator('.requirement-row-status').first().textContent(),'Not found');
      const available=await region.locator('[data-passage]').evaluateAll(links=>links.filter(el=>!el.hidden).length);
      assert.equal(available,26,'ambiguous and synthesized passages stay unlinked');
      const expected=mode==='zero'?{shown:0,partial:4,unclear:24}:{shown:4,partial:2,unclear:22};
      for(const status of ['shown','partial','unclear']){
        await region.locator(`[data-filter-status="${status}"]`).click();
        assert.equal(await region.locator('.requirement-rows > li:not([hidden])').count(),expected[status]);
        assert.equal(await region.locator(`[data-filter-status="${status}"]`).getAttribute('aria-pressed'),'true');
        assert.equal(await region.locator('.breakdown-results').textContent(),`${expected[status]} of 28 requirements`);
        assert.equal(await region.locator('.breakdown-empty').isVisible(),expected[status]===0);
      }
      const evidenceStatus=mode==='zero'?'partial':'shown';
      await region.locator(`[data-filter-status="${evidenceStatus}"]`).click();
      const evidenceRow=region.locator(`li[data-status="${evidenceStatus}"] .requirement-row`).first();
      await evidenceRow.locator('summary').click();
      assert.equal(await evidenceRow.locator('blockquote').textContent(),findings[0].evidence,'supporting evidence is preserved');
      await evidenceRow.locator('summary').click();
      await region.locator('[data-filter-status="all"]').click();
      assert.equal(await region.locator('.requirement-rows > li:not([hidden])').count(),28);
      assert.equal(await region.locator('.requirement-group').first().locator('h4').textContent(),'Required 22');
      assert.equal(await region.locator('.requirement-group').last().locator('h4').textContent(),'Preferred 6');
      await region.locator('.breakdown-content').evaluate(el=>el.scrollTop=0);
      await page.screenshot({path:path.join(artifactDir,`${name}-collapsed.png`)});
      await region.locator('.requirement-row > summary').first().focus();
      await region.locator('.requirement-row > summary').first().press('Enter');
      const firstEvidence=region.locator('.requirement-row').first().locator('.requirement-evidence');
      assert.ok(!(await firstEvidence.textContent()).includes('No supporting excerpt'),'empty evidence messages are not repeated');
      assert.equal(await firstEvidence.locator('blockquote').count(),0);
      assert.ok((await firstEvidence.boundingBox()).height<60,'an unevidenced row does not create a large empty box');
      await region.locator('.requirement-row > summary').nth(1).click();
      assert.equal(await region.locator('.requirement-row[open]').count(),2,'each row expands independently');
      for(const position of ['first','last']){
        await region.locator('.breakdown-content').evaluate((content,position)=>{
          content.scrollTop=position==='first'?0:content.scrollHeight;
        },position);
        await page.screenshot({path:path.join(artifactDir,`${name}-${position}.png`)});
      }
      await region.locator('.requirement-row > summary').first().press('Escape');
      assert.equal(await region.locator('.requirement-row').first().evaluate(el=>el.open),false);
      assert.equal(await region.isVisible(),true,'Escape closes the current row first');
      await region.getByRole('button',{name:'Close requirement breakdown',exact:true}).click();
      assert.equal(await region.isVisible(),false);
      assert.equal(await page.locator('.breakdown-open').getAttribute('aria-expanded'),'false');
      assert.equal(await page.locator('.breakdown-open').evaluate(el=>el===document.activeElement),true);
      assert.ok(Math.abs(await page.locator('.job-detail').evaluate(el=>el.scrollTop)-returnScroll)<1,'closing restores the previous reading position');
    };
    await open();await waitScore(20);
    const openingPosition=await page.evaluate(()=>({
      page:window.scrollY,
      pane:document.querySelector('.job-detail').getBoundingClientRect().top,
      dock:parseFloat(getComputedStyle(document.querySelector('.job-detail')).top),
      filters:document.querySelector('#job-controls').getBoundingClientRect().bottom,
      description:document.querySelector('#detail-body').getBoundingClientRect().top,
      viewport:innerHeight,
    }));
    assert.ok(openingPosition.page>0,'opening a job scrolls past the landing header');
    assert.ok(Math.abs(openingPosition.pane-openingPosition.dock)<2,'the pane aligns with its reading position');
    assert.ok(openingPosition.pane>=openingPosition.filters,'pinned filters do not cover the job header');
    assert.ok(openingPosition.description<openingPosition.viewport,'the job description starts within the viewport');
    await page.screenshot({path:path.join(artifactDir,'job-open-autoscroll.png')});
    assert.equal(postCalls,0,'cached assessments appear without calling the model');
    const up=page.getByRole('button',{name:'Helpful analysis',exact:true});
    const down=page.getByRole('button',{name:'Not helpful analysis',exact:true});
    const feedback=page.locator('.analysis-feedback-status');
    assert.equal(await up.getAttribute('aria-pressed'),'false');
    await up.click();
    assert.equal(await up.isDisabled(),true,'both review buttons are disabled while saving');
    assert.equal(await down.isDisabled(),true);
    await page.waitForFunction(()=>document.querySelector('[data-rating="up"]').getAttribute('aria-pressed')==='true');
    assert.deepEqual(lastReview,{resume_id:'r_systems',job_id:'job_0',checked_at:result.checkedAt,rating:'up'});
    assert.equal(await feedback.textContent(),'Feedback saved. Thank you.');
    await up.click();assert.equal(reviewCalls,1,'re-clicking the saved rating makes no duplicate request');
    reviewFailure=true;await down.click();
    await page.waitForFunction(()=>document.querySelector('.analysis-feedback-status').classList.contains('is-error'));
    assert.equal(await up.getAttribute('aria-pressed'),'true','a failed save preserves the previous rating');
    assert.equal(await down.isEnabled(),true,'failed feedback can be retried');
    reviewFailure=false;await down.click();
    await page.waitForFunction(()=>document.querySelector('[data-rating="down"]').getAttribute('aria-pressed')==='true');
    assert.equal(reviewCalls,3);assert.equal(postCalls,0,'reviews do not call the matching model');
    await open();await waitScore(20);
    assert.equal(await down.getAttribute('aria-pressed'),'true','the saved rating survives a page reload');
    assert.equal(await page.locator('.analysis-insights > li').count(),2);
    assert.equal(await page.locator('.analysis-point-labels,.analysis-status').count(),0,'per-requirement tags are removed');
    assert.equal(await page.getByRole('heading',{name:'Key things to review'}).isVisible(),true);
    assert.deepEqual(await page.locator('.analysis-metrics strong').allTextContents(),['4','2','22']);
    assert.equal(await page.locator('.requirement-breakdown').isVisible(),false);
    assert.equal(await page.locator('#detail-body > :first-child').textContent(),'About the role');
    assert.equal(await page.locator('#detail-body img,#detail-body script').count(),0);
    assert.equal(await page.evaluate(()=>window.xss),undefined);
    assert.equal(await page.locator('.jd-mark').count(),26,'ambiguous and synthesized requirements are not marked');
    assert.ok((await page.locator('.jd-mark').first().evaluate(el=>el.previousSibling.textContent)).endsWith('Coordinate with your team on release planning.'),'indicators follow the complete bullet, not the middle of a sentence');
    assert.equal(await page.locator('.match-overview-grid,.mstrip-toggle,#match-audit').count(),0,'old expansion UI is removed');
    assert.equal(await page.locator('.analysis-header-picker .select-picker').isVisible(),true,'resume selection is directly available in the analysis header');
    assert.equal(await page.locator('.analysis-more').count(),0,'resume management lives in the resume dropdown, not a separate menu');
    await page.locator('.analysis-header-picker .select-picker > summary').click();
    await pick('Data resume').click();await waitScore(60);
    assert.equal(await down.getAttribute('aria-pressed'),'false','a different resume does not inherit the review');
    await page.locator('.analysis-header-picker .select-picker > summary').click();
    await pick('Systems resume').click();await waitScore(20);
    assert.equal(await down.getAttribute('aria-pressed'),'true','returning to the original resume restores its review');
    const layout=await page.evaluate(()=>{
      const a=document.querySelector('.results-main'),b=document.querySelector('.job-detail');
      return {ratio:a.clientWidth/(a.clientWidth+b.clientWidth),leftOverflow:getComputedStyle(a).overflowY,rightOverflow:getComputedStyle(b).overflowY,analysis:document.querySelector('#detail-match').offsetHeight};
    });
    assert.ok(Math.abs(layout.ratio-0.6)<0.025,"the list takes 60% by default");assert.equal(layout.leftOverflow,'visible','the list scrolls with the page, footer after it');assert.equal(layout.rightOverflow,'auto');assert.ok(layout.analysis<540,'analysis is bounded without oversized cards');
    await checkReadingLayout();
    await page.evaluate(()=>window.scrollTo(0,document.querySelector('#results-split').offsetTop));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(()=>document.querySelector('.detail-head').getBoundingClientRect().top>=document.querySelector('#job-controls').getBoundingClientRect().bottom));
    await page.screenshot({path:path.join(artifactDir,'desktop-analyzed.png')});
    const separator=page.getByRole('separator',{name:'Resize job columns'});
    const widths=async()=>page.locator('#results-split').evaluate(el=>({list:el.querySelector('.results-main').getBoundingClientRect().width,detail:el.querySelector('.job-detail').getBoundingClientRect().width}));
    const beforeResize=await widths(),resizeCalls=postCalls,resizeGets=getCalls;
    const handle=await separator.boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+80);await page.mouse.down();
    // Leftward: at the 60% default the list is already near its widest.
    await page.mouse.move(handle.x+handle.width/2-160,handle.y+80,{steps:6});await page.mouse.up();
    const afterResize=await widths();
    assert.ok(afterResize.list<beforeResize.list-150 && afterResize.detail>beforeResize.detail+150,'dragging adjusts both column widths');
    assert.equal(postCalls,resizeCalls);assert.equal(getCalls,resizeGets,'resizing does not reload analysis');
    assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
    assert.equal(await page.locator('.job-detail').evaluate(el=>el.scrollTop),0);
    await page.screenshot({path:path.join(artifactDir,'desktop-resized.png')});
    await separator.press('ArrowLeft');assert.ok((await widths()).list<afterResize.list-20);
    // Home is the narrowest the list goes: no closer than its header needs, and never
    // so narrow that Sort runs into the tabs.
    await separator.press('Home');
    const headFit=await page.evaluate(()=>{const t=document.querySelector('#job-view-tabs').getBoundingClientRect(),s=document.querySelector('#list-sort').getBoundingClientRect();return {sameLine:Math.abs(t.top-s.top)<12||Math.abs(t.bottom-s.bottom)<12,clear:t.right<=s.left+1};});
    assert.ok((await widths()).list>=349,'the list stays at least 350px wide');
    assert.ok(headFit.sameLine&&headFit.clear,'at its narrowest the list still fits the tabs and Sort on one line');
    const dragFloor=(await widths()).list,floorHandle=await separator.boundingBox();
    await page.mouse.move(floorHandle.x+floorHandle.width/2,floorHandle.y+80);await page.mouse.down();
    await page.mouse.move(floorHandle.x-300,floorHandle.y+80,{steps:6});await page.mouse.up();
    assert.ok(Math.abs((await widths()).list-dragFloor)<1,'dragging further left stops at the same point');
    await separator.press('End');assert.ok(Math.abs((await widths()).detail-440)<1);
    const filled=await page.locator('#results-split').evaluate(el=>Math.abs(el.clientWidth-el.querySelector('.results-main').getBoundingClientRect().width-el.querySelector('.job-detail').getBoundingClientRect().width-el.querySelector('.column-resizer').offsetWidth-2*parseFloat(getComputedStyle(el).columnGap))<1);
    assert.equal(filled,true,'the columns fill the available width even at the drag limits');
    assert.equal(await page.locator('.job-detail').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'the narrowest detail column stays readable without horizontal overflow');
    await page.screenshot({path:path.join(artifactDir,'desktop-narrow-inspector.png')});
    const persisted=await page.evaluate(()=>localStorage.getItem('find-jobs-column-ratio'));
    await open();await waitScore(20);
    assert.equal(await page.evaluate(()=>localStorage.getItem('find-jobs-column-ratio')),persisted);
    assert.ok(Math.abs((await widths()).detail-440)<1,'preferred width survives a reload');
    await separator.dblclick();
    assert.ok(Math.abs((await widths()).list/((await widths()).list+(await widths()).detail)-0.6)<0.005,'double-click restores the default width');
    const resetWidths=await widths(),resetHandle=await separator.boundingBox();
    await page.mouse.move(resetHandle.x+resetHandle.width/2,resetHandle.y+80);await page.mouse.down();
    await page.mouse.move(resetHandle.x+resetHandle.width/2+100,resetHandle.y+80);
    await separator.press('Escape');await page.mouse.up();
    assert.ok(Math.abs((await widths()).list-resetWidths.list)<1,'Escape cancels an active drag');
    assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('is-resizing-columns')),false);
    assert.equal(await page.locator('.analysis-point-actions .requirement-locate').count(),0,'no separate locate arrows remain');
    const passageLink=page.locator('.analysis-insights .requirement-locate').first();
    const passageText=await passageLink.getAttribute('data-passage');
    const windowBeforeJump=await page.evaluate(()=>window.scrollY);
    await passageLink.click();
    assert.equal(await page.locator('#detail-body .desc-hit').textContent(),passageText+'?');
    assert.ok(await page.locator('.job-detail').evaluate(el=>el.scrollTop>0),'clicking requirement text scrolls the inspector');
    assert.equal(await page.evaluate(()=>window.scrollY),windowBeforeJump,'the page itself stays in place');
    assert.equal(await page.locator('#detail-body .desc-hit').evaluate(el=>el===document.activeElement),true);
    await page.locator('.job-detail').evaluate(el=>el.scrollTop=0);
    await passageLink.focus();await passageLink.press('Enter');
    assert.equal(await page.locator('#detail-body .desc-hit').evaluate(el=>el===document.activeElement),true,'Enter navigates to the employer passage');
    await page.locator('.job-detail').evaluate(el=>el.scrollTop=0);
    const callsBeforeBreakdown=postCalls;
    await page.locator('.breakdown-open').click();
    await checkExpanded('desktop-expanded');
    assert.equal(postCalls,callsBeforeBreakdown,'reading the breakdown makes no model request');
    await page.locator('.breakdown-open').click();
    const firstRow=page.locator('.requirement-row').first();
    await firstRow.locator('summary').click();
    await firstRow.getByRole('link',{name:'Find in JD',exact:true}).click();
    assert.equal(await page.locator('.requirement-breakdown').isVisible(),false);
    assert.equal(await page.locator('#detail-body .desc-hit').evaluate(el=>el===document.activeElement),true,'Find in JD closes the modal and focuses the JD passage');
    await page.locator('.job-detail').evaluate(el=>el.scrollTop=0);
    const original=await page.locator('#detail-body').evaluate(el=>{const c=el.cloneNode(true);c.querySelectorAll('.jd-mark,.jd-note').forEach(x=>x.remove());return c.textContent;});
    assert.equal(await page.getByLabel('Match highlights',{exact:true}).evaluate(el=>!!el.closest('.description-controls')),true);
    await page.getByLabel('Match highlights',{exact:true}).uncheck();assert.equal(await page.locator('.jd-mark').count(),0);
    assert.equal(await page.locator('#detail-body').textContent(),original);
    assert.equal(await page.evaluate(()=>localStorage.getItem('find-jobs-jd-marks')),'off');
    await page.getByLabel('Match highlights',{exact:true}).focus();
    await page.getByLabel('Match highlights',{exact:true}).press('Space');
    assert.equal(await page.getByLabel('Match highlights',{exact:true}).isChecked(),true);
    assert.equal(await page.locator('.jd-mark').count(),26);
    await page.locator('.jd-mark').first().click();
    assert.ok((await page.locator('.jd-note').textContent()).includes(findings[0].evidence));
    await page.locator('.jd-mark').first().press('Escape');
    const savedSwitchCalls=postCalls;
    await page.locator('.analysis-header-picker .select-picker > summary').press('ArrowDown');
    await pick('Data resume').waitFor();
    await page.screenshot({path:path.join(artifactDir,'desktop-resume-picker.png')});
    await pick('Data resume').press('Enter');
    assert.equal(await page.locator('.analysis-score-number').count(),0,'old resume score disappears immediately');
    assert.equal(await page.locator('.jd-mark').count(),0);
    await waitScore(60);
    assert.equal(postCalls,savedSwitchCalls,'selecting a resume with a saved analysis makes no model request');
    assert.deepEqual(await page.locator('.analysis-metrics strong').allTextContents(),['2','0','0']);
    assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
    assert.equal(await page.locator('.analysis-header-picker .select-picker > summary').textContent(),'Data resume');
    await page.locator('.analysis-header-picker .select-picker > summary').press('ArrowDown');
    await page.waitForFunction(()=>document.querySelector('#detail-match .select-option.is-selected')===document.activeElement);
    assert.equal(await page.locator('#detail-match .select-option.is-selected').textContent(),'Data resume','reopening the picker focuses the current resume, even when it is not first');
    await pick('Data resume').press('Escape');
    postScore=66;
    await page.getByRole('button',{name:'Reanalyze',exact:true}).click();
    assert.equal(await page.locator('.analysis-score-number').textContent(),'60/100','previous score remains during reanalysis');
    assert.equal(await page.locator('.analysis-insights > li').count(),2);
    await page.getByText('Updating analysis… Previous result shown.',{exact:true}).waitFor();
    await waitScore(66);await page.waitForFunction(()=>document.querySelector('.analysis-shell').getAttribute('aria-busy')==='false');
    assert.equal(postCalls,1);assert.equal(lastPost.force,true);
    mode='post-error';await page.getByRole('button',{name:'Reanalyze',exact:true}).click();
    await page.getByText('Matching temporarily unavailable.',{exact:true}).waitFor();
    assert.equal(await page.locator('.analysis-score-number').textContent(),'66/100','failed updates preserve the previous result');
    mode='normal';
    // The header and the slim scroll bar both carry Save and Apply; use the header's.
    await page.locator('#detail-top .detail-save').click();assert.equal(await page.locator('#detail-top .detail-save').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#detail-bar .detail-save').getAttribute('aria-pressed'),'true','both Save buttons stay in step');
    assert.equal(await page.locator('#detail-top .detail-apply').getAttribute('href'),'https://example.com/job');
    assert.ok((await page.locator('.detail-meta').textContent()).includes('160'));
    // The list is part of the page, so its position is the page's scroll position.
    await page.evaluate(()=>{window.scrollTo(0,document.querySelector('#results-split').offsetTop+200);document.querySelector('.job-detail').scrollTop=500;});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    // LinkedIn-style: the full header scrolls away and the slim bar takes over at the top.
    const scrolled=await page.evaluate(()=>({left:window.scrollY,right:document.querySelector('.job-detail').scrollTop,bar:document.querySelector('#detail-bar').classList.contains('is-shown'),barTop:document.querySelector('#detail-bar').getBoundingClientRect().top,pane:document.querySelector('.job-detail').getBoundingClientRect().top}));
    assert.ok(scrolled.right>0&&scrolled.left>0);assert.ok(scrolled.bar,'slim bar shows once the header is scrolled away');assert.ok(Math.abs(scrolled.barTop-scrolled.pane)<3,'slim bar sits at the top of the pane');
    const listAt=await page.evaluate(()=>window.scrollY);
    await page.locator('.job[data-job-id="job_4"]').click();assert.equal(await page.locator('.job-detail').evaluate(el=>el.scrollTop),0);
    assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-listAt)<40,'job selection retains list position');
    await waitScore(60);
    await page.evaluate(()=>document.querySelector('.job-detail').scrollTop=350);
    await page.locator('.page-next').click();assert.equal(new URL(page.url()).searchParams.get('page'),'2');
    await page.waitForFunction(()=>document.querySelector('.job[data-job-id]')?.classList.contains('is-selected'));
    assert.equal(await page.locator('.job-detail').evaluate(el=>el.scrollTop),0,'pagination opens its first role at the top');
    await page.goBack();await page.waitForURL(base+'/');await page.goForward();await page.waitForURL(base+'/?page=2');
    // A single click from the unanalyzed state immediately exposes score + findings.
    mode='unanalyzed';postScore=20;await page.evaluate(()=>localStorage.setItem('find-jobs-active-resume','r_systems'));
    await open();await page.getByRole('button',{name:'Analyze resume',exact:true}).waitFor();
    assert.equal(await activeResume(),'r_systems');
    assert.equal(await page.locator('.analysis-score-number').count(),0);
    assert.equal(await page.locator('.description-controls').isVisible(),false,'highlights are offered only after analysis');
    const entryHeading=await page.locator('.analysis-entry h3').boundingBox();
    const analyzeButton=await page.getByRole('button',{name:'Analyze resume',exact:true}).boundingBox();
    assert.ok(analyzeButton.y >= entryHeading.y+entryHeading.height,'Analyze resume sits below Resume match');
    assert.ok(Math.abs(analyzeButton.x-entryHeading.x)<2,'Analyze resume aligns with the heading');
    await page.screenshot({path:path.join(artifactDir,'desktop-entry.png')});
    await page.getByRole('button',{name:'Analyze resume',exact:true}).press('Shift+Tab');
    assert.equal(await page.locator('#detail-match .resume-picker > summary').evaluate(el=>el===document.activeElement),true);
    await page.locator('#detail-match .resume-picker > summary').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#detail-match .resume-picker').open);
    assert.equal(await pick('Systems resume').getAttribute('aria-pressed'),'true');
    // The toggle event that moves focus fires after the dropdown opens, not with it.
    await page.waitForFunction(()=>document.activeElement?.matches('#detail-match .select-option[aria-pressed="true"]'),null,{timeout:2000}).catch(()=>assert.fail('opening focuses the selected resume'));
    assert.equal(await page.locator('#detail-match .resume-picker-delete').count(),3,'every resume has its own delete button');
    assert.equal(await page.locator('#detail-match .resume-picker-panel > :last-child').textContent(),'Add resume','Add resume is the last item');
    await page.screenshot({path:path.join(artifactDir,'desktop-entry-options.png')});
    await pick('Systems resume').press('Escape');
    assert.equal(await page.locator('#detail-match .resume-picker').evaluate(el=>el.open),false);
    assert.equal(await page.locator('#detail-match .resume-picker > summary').evaluate(el=>el===document.activeElement),true);
    const before=postCalls;
    await page.getByRole('button',{name:'Analyze resume',exact:true}).click();
    await page.getByText('Analyzing resume…',{exact:true}).last().waitFor();
    assert.equal(await page.locator('.analysis-shell').getAttribute('aria-busy'),'true');
    await waitScore(20);assert.equal(postCalls,before+1);assert.equal(lastPost.resume_id,'r_systems');assert.equal(lastPost.force,false);
    assert.equal(await page.locator('.analysis-insights > li').count(),2);
    assert.equal(await page.locator('.analysis-insights').isVisible(),true);
    const callsBeforeReturn=postCalls,getsBeforeReturn=getCalls;
    await page.locator('.job[data-job-id="job_1"]').click();await page.getByRole('button',{name:'Analyze resume',exact:true}).waitFor();
    await page.locator('.job[data-job-id="job_0"]').click();await waitScore(20);
    assert.equal(postCalls,callsBeforeReturn);assert.equal(getCalls,getsBeforeReturn+1,'returning to an assessed job uses the in-page cache');
    mode='zero';await open();await waitScore(20);
    assert.deepEqual(await page.locator('.analysis-metrics strong').allTextContents(),['0','4','24']);
    assert.equal(await page.locator('.analysis-insights > li').count(),2);
    assert.equal(await page.getByText('No fully demonstrated requirements were found.',{exact:true}).count(),0);
    await page.setViewportSize({width:1280,height:800});await open();await waitScore(20);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await checkReadingLayout();
    await page.screenshot({path:path.join(artifactDir,'desktop-1280.png')});
    await page.setViewportSize({width:1120,height:800});await open();await waitScore(20);
    await checkReadingLayout();
    await page.screenshot({path:path.join(artifactDir,'desktop-1120.png')});
    await page.setViewportSize({width:390,height:844});await open();await waitScore(20);
    assert.equal(await separator.isVisible(),false,'the divider is hidden in the mobile single-column view');
    assert.equal(await page.locator('#detail-top').getByRole('button',{name:'Back to jobs',exact:true}).isVisible(),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await checkReadingLayout();
    await page.screenshot({path:path.join(artifactDir,'mobile-analyzed.png')});
    await page.locator('.breakdown-open').click();
    await checkExpanded('mobile-expanded');
    await page.locator('#detail-top').getByRole('button',{name:'Back to jobs',exact:true}).press('Shift+Tab');
    assert.ok(await page.evaluate(()=>document.querySelector('#job-detail').contains(document.activeElement)));
    await page.locator('#detail-match .resume-picker > summary').click();await page.locator('#detail-match .resume-picker > summary').press('Escape');
    assert.equal(await page.locator('#job-detail').isVisible(),true);
    await page.locator('#detail-top').getByRole('button',{name:'Back to jobs',exact:true}).click();await page.locator('#job-detail').waitFor({state:'hidden'});
    mode='unanalyzed';await open();await page.getByRole('button',{name:'Analyze resume',exact:true}).waitFor();
    assert.equal(await page.locator('.analysis-feedback').count(),0,'unanalysed jobs do not show review controls');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(artifactDir,'mobile-entry.png')});
    await page.locator('#detail-match .resume-picker > summary').click();
    const entryMenu=await page.locator('#detail-match .resume-picker-panel').boundingBox();
    assert.ok(entryMenu.x>=0 && entryMenu.x+entryMenu.width<=390,'Resume options stay inside the mobile viewport');
    await page.screenshot({path:path.join(artifactDir,'mobile-entry-options.png')});
    await page.locator('#detail-match .resume-picker > summary').click();
    for(const state of ['no-resume','error','signed-out','no-description']){
      mode=state;await open();
      const expected=state==='no-resume'?'Upload resume':state==='error'?'Storage temporarily unavailable.':state==='signed-out'?'Upload resume':'This job has no description to compare against.';
      await page.locator('#detail-match').getByText(expected,{exact:state!=='error'}).waitFor();assert.equal(await page.locator('#detail-body').isVisible(),true);
      if(state==='signed-out') {
        const uploadsBefore=resumePostCalls, analysesBefore=postCalls;
        assert.equal(await page.locator('#detail-match .match-signin').count(),0,'no sign-in control is shown before Upload');
        let chooserOpened=false;
        const onChooser=()=>{chooserOpened=true;};page.on('filechooser',onChooser);
        await page.getByRole('button',{name:'Upload resume',exact:true}).click();
        const signInPopup=page.getByRole('dialog',{name:'Sign in to upload your resume',exact:true});
        await signInPopup.waitFor();
        await page.screenshot({path:path.join(artifactDir,'resume-upload-signin-mobile.png')});
        await signInPopup.getByRole('button',{name:'Close sign-in popup',exact:true}).press('Escape');
        await signInPopup.waitFor({state:'hidden'});
        assert.equal(await page.locator('#job-detail').isVisible(),true,'Escape closes the popup without closing the mobile job');
        assert.equal(await page.getByRole('button',{name:'Upload resume',exact:true}).evaluate(el=>el===document.activeElement),true);
        await page.getByRole('button',{name:'Upload resume',exact:true}).click();
        await signInPopup.getByRole('button',{name:'Close sign-in popup',exact:true}).click();
        assert.equal(chooserOpened,false,'signed-out Upload does not open the file chooser');
        assert.equal(resumePostCalls,uploadsBefore);assert.equal(postCalls,analysesBefore);
        page.off('filechooser',onChooser);
      }
      if(state==='no-resume') {
        await page.locator('#detail-match input[type="file"]').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Built and operated backend services, improved reliability and maintained automated tests. Collaborated with engineering teams to deliver production APIs.')});
        await waitScore(20);await page.locator('#detail-match .resume-picker > summary').click();
        page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Delete Uploaded resume',exact:true}).click();
        assert.ok((await page.locator('.analysis-source').textContent()).includes('Uploaded resume'),'canceling removal preserves the selected resume');
        page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete Uploaded resume',exact:true}).click();
        await page.getByRole('button',{name:'Upload resume',exact:true}).waitFor();assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
      }
    }
    mode='normal';postScore=74;
    await page.evaluate(()=>localStorage.setItem('find-jobs-active-resume','r_systems'));
    await open();await waitScore(20);
    await page.locator('.analysis-header-picker .select-picker > summary').click();
    await pick('Frontend resume').click();
    await page.getByRole('button',{name:'Analyze resume',exact:true}).waitFor();
    assert.equal(await activeResume(),'r_frontend');
    assert.equal(await page.locator('.analysis-score-number').count(),0,'switching to an unscored resume clears the old score');
    assert.equal(await page.locator('.jd-mark').count(),0);
    assert.equal(await page.locator('.analysis-header-picker').isVisible(),true,'the selector stays in the header for the new analysis');
    assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
    await page.waitForFunction(()=>!document.querySelector('#detail-match .analysis-loading'));
    assert.equal(await page.getByText('Not analyzed',{exact:true}).count(),0,'a switched-to resume shows no "Not analyzed" label');
    const switchedPicker=await page.locator('#detail-match .resume-picker > summary').boundingBox(),switchedRun=await page.getByRole('button',{name:'Analyze resume',exact:true}).boundingBox();
    assert.ok(switchedRun.y>=switchedPicker.y+switchedPicker.height && switchedRun.y-(switchedPicker.y+switchedPicker.height)<=16,'Analyze resume sits right below the resume dropdown');
    assert.ok(Math.abs(switchedRun.x-switchedPicker.x)<2,'Analyze resume lines up with the dropdown');
    await page.screenshot({path:path.join(artifactDir,'mobile-resume-switched.png')});
    const newResumeCalls=postCalls;
    await page.getByRole('button',{name:'Analyze resume',exact:true}).click();await waitScore(74);
    assert.equal(await down.getAttribute('aria-pressed'),'false','new analyses start unrated');
    assert.equal(postCalls,newResumeCalls+1);assert.equal(lastPost.resume_id,'r_frontend');assert.equal(lastPost.force,false);
    const cachedSwitchGets=getCalls,cachedSwitchPosts=postCalls;
    await page.locator('.analysis-header-picker .select-picker > summary').click();
    await pick('Systems resume').click();await waitScore(20);
    assert.equal(getCalls,cachedSwitchGets,'returning to a loaded resume reuses its result immediately');
    assert.equal(postCalls,cachedSwitchPosts);
    mode='twenty-seven';
    await open();await waitScore(20);
    await page.getByRole('button',{name:'Full requirement breakdown (27)',exact:true}).click();
    assert.equal(await page.locator('.requirement-row').count(),27,'all 27 requirements are preserved');
    assert.equal(await page.locator('.breakdown-results').textContent(),'27 of 27 requirements');
    assert.equal(await page.locator('.requirement-row[open]').count(),0);
    await page.getByRole('button',{name:'Close requirement breakdown',exact:true}).press('Escape');
    assert.equal(await page.locator('.requirement-breakdown').isVisible(),false,'Escape closes the modal');
    assert.equal(await page.locator('.breakdown-open').evaluate(el=>el===document.activeElement),true);
    await page.locator('.breakdown-open').click();
    await page.mouse.click(2,2);
    assert.equal(await page.locator('.requirement-breakdown').isVisible(),false,'clicking the backdrop closes the modal');
    mode='normal';await page.setViewportSize({width:1440,height:900});await page.goto(base);
    // Beside the list, the first role on screen is always selected.
    const firstSelected=async(why)=>{
      await page.waitForFunction(()=>{const r=document.querySelector('#job-list .job[data-job-id]');return r&&r.classList.contains('is-selected')&&document.querySelector('#detail-title')?.textContent===r.querySelector('.job-title').textContent;},null,{timeout:3000}).catch(()=>assert.fail(why));
    };
    await firstSelected('the first role is selected on arrival');
    assert.equal(await page.evaluate(()=>scrollY),0,'arriving does not scroll the page');
    await page.locator('#job-search').fill('Platform 7');
    await firstSelected('the first role is selected after a filter change');
    assert.equal(await page.locator('#detail-title').textContent(),'Software Engineer, Platform 7');
    await page.locator('#job-search').fill('');await firstSelected('clearing the search selects the new first role');
    await page.locator('#job-pagination .page-next').click();
    await firstSelected('the first role on the next page is selected');
    assert.equal(new URL(page.url()).searchParams.get('page'),'2');
    await page.goto(base);await firstSelected('the first role is selected on arrival again');
    // All jobs / Companies tabs.
    await page.locator('#view-grouped').waitFor();
    assert.equal(await page.locator('#count-flat').textContent(),'140');
    assert.equal(await page.locator('#count-grouped').textContent(),'3','the Companies tab counts companies');
    await page.locator('#view-grouped').click();
    assert.equal(await page.locator('#view-grouped').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.cgroup').count(),3);
    assert.ok(new URL(page.url()).searchParams.get('view')==='grouped','the Companies tab is in the URL');
    assert.ok((await page.locator('#job-count').textContent()).includes('of 3 companies · 140 roles'));
    await firstSelected('the Companies tab selects the first role of the first company');
    assert.equal(await page.locator('.cgroup').first().evaluate(el=>el.classList.contains('is-open')),true,'the first company opens by itself');
    assert.equal(await page.locator('.cgroup.is-open').count(),1);
    const bigCo=page.locator('.cg-head[data-company="Engineering Company"]');
    assert.ok((await bigCo.textContent()).includes('138 roles'));
    // Companies on the same day are shuffled per visit, so it may be the one already open.
    if (await bigCo.getAttribute('aria-expanded')!=='true') await bigCo.click();
    else { await bigCo.click(); await bigCo.click(); }
    assert.equal(await page.locator('.cgroup:has(.cg-head[data-company="Engineering Company"]) .job[data-job-id]').count(),138,'opening a company lists its roles');
    assert.equal(await page.locator('.cgroup.is-open .job-company').count(),0,'rows in a card do not repeat the company');
    assert.equal(await bigCo.evaluate(el=>el===document.activeElement),true,'focus stays on the company after it opens');
    await page.screenshot({path:path.join(artifactDir,'companies-1440.png')});
    await page.locator('.cgroup.is-open .job[data-job-id="job_2"] .job-title').click();
    assert.equal(await page.locator('#detail-title').textContent(),'Software Engineer, Platform 3','a role in a card opens in the pane');
    await page.reload();await page.locator('.cgroup').first().waitFor();
    assert.equal(await page.locator('#view-grouped').getAttribute('aria-pressed'),'true','a reload keeps the Companies tab');
    await page.goto(base);await page.locator('#view-flat').waitFor();
    assert.equal(await page.locator('.cgroup').count(),0);
    await page.locator('#view-grouped').click();await page.goBack();
    await page.waitForFunction(()=>document.querySelector('#view-flat').getAttribute('aria-pressed')==='true');
    assert.equal(await page.locator('.cgroup').count(),0,'Back returns to All jobs');
    // Two tabs and Sort, with a hairline between each.
    assert.equal(await page.locator('#saved-toggle').count(),0,'there is no Saved tab');
    assert.equal(await page.locator('#job-view-tabs .seg').count(),2);
    const hairlines=await page.evaluate(()=>[document.querySelector('#view-grouped'),document.querySelector('#list-sort')].map(n=>{const b=getComputedStyle(n,'::before');return b.content!=='none'&&parseFloat(b.width)===1;}));
    assert.deepEqual(hairlines,[true,true],'a hairline sits before Companies and before Sort');
    // Toolbar: Sort and Saved left it; Save this filter joined the Hide checkboxes.
    assert.equal(await page.locator('#job-controls #sort-select').count(),0,'Sort is not in the filter toolbar');
    const tailRow=await page.evaluate(()=>{const c=(n)=>{const r=n.getBoundingClientRect();return r.top+r.height/2;};return Math.abs(c(document.querySelector('.preset-save'))-c(document.querySelector('#hide-opened').closest('label')));});
    assert.ok(tailRow<6,'Save this filter sits in the row with the Hide checkboxes');
    await page.setViewportSize({width:390,height:844});await page.goto(base+'/index.html');await page.locator('.job').first().waitFor();await page.waitForTimeout(400);
    assert.equal(await page.locator('#job-detail').evaluate(el=>el.classList.contains('is-open')),false,'on a phone nothing opens over the list by itself');
    for(const width of [800,390]){
      await page.setViewportSize({width,height:900});await page.goto(base+'?view=grouped');await page.locator('.cgroup').first().waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scroll at '+width);
      await page.screenshot({path:path.join(artifactDir,'companies-'+width+'.png')});
    }
    await page.setViewportSize({width:1440,height:900});await page.goto(base);await page.locator('.job').first().waitFor();
    assert.equal(await page.locator('#resume-library').count(),0,'no Resumes section beside the filters');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(artifactDir,'toolbar-1440.png')});
    await page.locator('.job[data-job-id="job_0"]').click();await waitScore(20);
    const paneOpen=async()=>{const p=page.locator('#detail-match .resume-picker');if(!await p.evaluate(el=>el.open))await p.locator('summary').click();};
    const paneDelete=async(name)=>{await paneOpen();await page.locator('#detail-match').getByRole('button',{name:'Delete '+name,exact:true}).click();};
    const fixtureFile={name:'pane-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Built and operated backend services, improved reliability and maintained automated tests. Collaborated with engineering teams to deliver production APIs.')};
    const beforeUploads=resumePostCalls;
    await page.locator('#detail-match input[type="file"]').setInputFiles(fixtureFile);
    await waitScore(postScore);
    assert.equal(resumePostCalls,beforeUploads+1);
    assert.ok(lastResumePost.text.startsWith('Built and operated backend services'),'the extracted text is uploaded');
    assert.equal(lastResumePost.file,undefined,'without ?upload=files the original file is not sent');
    assert.equal(await activeResume(),'r_uploaded','a new upload becomes the active resume');
    assert.equal(await page.locator('#detail-match [data-act="choose"]').count(),4,'adding a resume updates the dropdown');
    const beforeDeletes=resumeDeleteCalls;
    page.once('dialog',dialog=>dialog.dismiss());await paneDelete('Uploaded resume');
    assert.equal(resumeDeleteCalls,beforeDeletes,'cancelled removal makes no request');
    resumeWriteError=true;page.once('dialog',dialog=>dialog.accept());await paneDelete('Uploaded resume');
    await page.locator('#detail-match').getByText('Resume removal temporarily unavailable.',{exact:true}).waitFor();
    assert.equal(await page.locator('#detail-match [data-act="choose"]').count(),4,'a failed removal retains the resume');
    resumeWriteError=false;page.once('dialog',dialog=>dialog.accept());await paneDelete('Uploaded resume');
    await page.waitForFunction(()=>document.querySelectorAll('#detail-match [data-act="choose"]').length===3);
    assert.notEqual(await activeResume(),'r_uploaded','removing the active resume selects a remaining resume');
    // ?upload=files turns on sending the original file, and is remembered.
    await page.goto(base+'?upload=files');await page.locator('.job[data-job-id="job_0"]').click();await waitScore(20);
    const filesBefore=resumePostCalls;
    await page.locator('#detail-match input[type="file"]').setInputFiles(fixtureFile);
    await waitScore(postScore);
    assert.equal(resumePostCalls,filesBefore+1);
    assert.equal(Buffer.from(lastResumePost.file,'base64').toString(),fixtureFile.buffer.toString(),'with ?upload=files the original file is uploaded with the text');
    assert.equal(await page.evaluate(()=>localStorage.getItem('find-jobs-upload-files')),'1','the switch is remembered');
    await page.goto(base+'?upload=text');await page.locator('.job').first().waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('find-jobs-upload-files')),null,'?upload=text turns it off');
    page.once('dialog',dialog=>dialog.accept());await paneDelete('Uploaded resume');
    await page.waitForFunction(()=>document.querySelectorAll('#detail-match [data-act="choose"]').length===3);
    for(const width of [1280,800,390]){
      await page.setViewportSize({width,height:900});await page.goto(base);await page.locator('.job').first().waitFor();
      assert.equal(await page.locator('#resume-library').count(),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(artifactDir,'toolbar-'+width+'.png')});
    }
    // A phone's browser Back closes the sheet, preserving the list beneath it.
    const mobile=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    mobile.setDefaultTimeout(8000);
    mobile.on('pageerror',e=>errors.push(e.message));
    await mobile.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    const navigationPosts=postCalls;
    const sheet=mobile.locator('#job-detail');
    const backButton=()=>mobile.locator('#detail-top').getByRole('button',{name:'Back to jobs',exact:true});
    const waitClosed=()=>sheet.waitFor({state:'hidden'});
    await mobile.goto(base+'/about.html');
    await mobile.goto(base+'/?q=Platform%207');
    const mobileRole=mobile.locator('.job[data-job-id="job_6"] .job-title');
    await mobileRole.waitFor();await mobileRole.scrollIntoViewIfNeeded();
    const listUrl=mobile.url(),listScroll=await mobile.evaluate(()=>scrollY),listHistory=await mobile.evaluate(()=>history.length);
    await mobileRole.click();await sheet.waitFor({state:'visible'});
    assert.equal(await mobile.evaluate(()=>history.length),listHistory+1,'opening a mobile description adds one Back step');
    await mobile.screenshot({path:path.join(artifactDir,'mobile-history-detail.png')});
    await mobile.goBack();await waitClosed();
    assert.equal(mobile.url(),listUrl,'browser Back stays in the app on the same list');
    assert.equal(await mobile.locator('#job-search').inputValue(),'Platform 7','Back preserves the search');
    await mobile.waitForFunction(y=>Math.abs(scrollY-y)<2,listScroll);
    assert.equal(await mobileRole.evaluate(el=>el===document.activeElement),true,'Back restores focus to the role');
    await mobile.screenshot({path:path.join(artifactDir,'mobile-history-list.png')});
    await mobile.goForward();await sheet.waitFor({state:'visible'});
    assert.equal(await mobile.locator('#detail-title').textContent(),'Software Engineer, Platform 7','Forward reopens the selected role');
    await mobile.reload();await sheet.waitFor({state:'visible'});
    assert.equal(await mobile.locator('#detail-title').textContent(),'Software Engineer, Platform 7','reloading a description preserves its Back step');
    assert.equal(await mobile.evaluate(()=>history.length),listHistory+1,'Forward and reload do not add duplicate entries');
    await backButton().click();await waitClosed();
    await mobile.goForward();await sheet.waitFor({state:'visible'});
    await backButton().press('Escape');await waitClosed();
    await mobile.goBack();
    assert.equal(new URL(mobile.url()).pathname,'/about.html','Back from the list can still leave normally; no navigation trap');
    // Companies keep their expanded roles and tab navigation when the sheet closes.
    await mobile.goto(base+'/?q=Software');await mobile.locator('.job').first().waitFor();
    await mobile.locator('#view-grouped').click();
    const company=mobile.locator('.cg-head[data-company="Engineering Company"]');
    await company.click();
    const groupedRole=mobile.locator('.cg-body .job[data-job-id="job_2"] .job-title');
    await groupedRole.scrollIntoViewIfNeeded();
    const companyScroll=await mobile.evaluate(()=>scrollY),companyUrl=mobile.url();
    await groupedRole.click();await sheet.waitFor({state:'visible'});
    await mobile.goBack();await waitClosed();
    assert.equal(mobile.url(),companyUrl);
    assert.equal(await company.getAttribute('aria-expanded'),'true','Back keeps the company expanded');
    await mobile.waitForFunction(y=>Math.abs(scrollY-y)<2,companyScroll);
    assert.equal(await mobile.locator('#job-search').inputValue(),'Software');
    await mobile.goBack();
    await mobile.waitForFunction(()=>document.querySelector('#view-flat')?.getAttribute('aria-pressed')==='true');
    assert.equal(await sheet.isVisible(),false,'the next Back returns to All jobs, without reopening a description');
    assert.equal(postCalls,navigationPosts,'history navigation never starts a paid analysis');
    await mobile.close();
    // Exercise the upload sign-in continuation with a fixture Google button/token.
    // No Google account, real credential or external authentication request is used.
    mode='signed-out';
    const signInPage=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    let signInAttempts=0;
    await signInPage.route('**/*',async route=>{
      const url=route.request().url();
      if(url===base+'/api/auth/config')return route.fulfill({json:{clientId:'fixture-client'}});
      if(url===base+'/api/auth/google') {
        signInAttempts++;
        if(signInAttempts===1)return route.fulfill({status:503,json:{error:'Sign-in temporarily unavailable. Please try again.'}});
        mode='no-resume';return route.fulfill({json:{account:{id:'fixture',name:'Test user'},sync:{}}});
      }
      if(url==='https://accounts.google.com/gsi/client')return route.fulfill({contentType:'text/javascript',body:`window.google={accounts:{id:{initialize(options){window.fixtureCredential=options.callback},renderButton(host){const button=document.createElement('button');button.type='button';button.textContent='Continue with Google';button.onclick=()=>window.fixtureCredential({credential:'fixture-token'});host.replaceChildren(button)},disableAutoSelect(){}}}};`});
      return url.startsWith(base)?route.continue():route.abort();
    });
    await signInPage.goto(base);await signInPage.locator('#detail-title').waitFor();
    const uploadAction=()=>signInPage.getByRole('button',{name:'Upload resume',exact:true});
    await uploadAction().click();
    const uploadSignIn=signInPage.getByRole('dialog',{name:'Sign in to upload your resume',exact:true});
    await uploadSignIn.getByRole('button',{name:'Continue with Google',exact:true}).click();
    await uploadSignIn.getByText('Sign-in temporarily unavailable. Please try again.',{exact:true}).waitFor();
    await uploadSignIn.getByRole('button',{name:'Continue with Google',exact:true}).click();
    await uploadSignIn.waitFor({state:'hidden'});
    const chooser=signInPage.waitForEvent('filechooser');
    await uploadAction().click();await chooser;
    assert.equal(signInAttempts,2,'sign-in can be retried and then unlocks the real upload action');
    await signInPage.close();mode='normal';
    // Filter categories live in the controls; selection labels also survive reload.
    const filters=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    filters.setDefaultTimeout(8000);
    filters.on('pageerror',e=>errors.push(e.message));
    await filters.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    await filters.goto(base);await filters.locator('.job').first().waitFor();
    assert.equal(await filters.locator('.picker-label').count(),0,'no duplicate labels above filters');
    assert.equal(await filters.locator('#sum-role').textContent(),'Role');
    assert.equal(await filters.locator('#sum-company').textContent(),'Company');
    const posted=filters.locator('#date-select + details > summary');
    const salary=filters.locator('#salary-select + details > summary');
    assert.equal(await posted.textContent(),'Posted');
    assert.equal(await salary.textContent(),'Salary');
    const companySummary=filters.locator('#sum-company');
    const advancedToggle=filters.locator('#advanced-filters > summary');
    assert.equal(await filters.locator('#primary-grid .picker-wrap').count(),4);
    assert.equal(await filters.locator('#advanced-grid .picker-wrap').count(),6);
    assert.equal(await filters.locator('#advanced-filters').evaluate(el=>el.open),false);
    const resultsTop=await filters.locator('#results-split').evaluate(el=>el.getBoundingClientRect().top);
    for(const width of [1440,1280]) {
      await filters.setViewportSize({width,height:900});
      const row=await filters.locator('#primary-grid > .picker-wrap, #advanced-filters').evaluateAll(items=>items.map(el=>Math.round(el.getBoundingClientRect().top)));
      assert.ok(row.every(y=>Math.abs(y-row[0])<2),'four filters and Advanced share one row at '+width);
      assert.ok(await filters.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await filters.setViewportSize({width:1440,height:900});
    await advancedToggle.click();
    assert.equal(await filters.locator('#results-split').evaluate(el=>el.getBoundingClientRect().top),resultsTop,'advanced popover does not shift results');
    await companySummary.click();
    await filters.locator('#list-company input[value="Telescope"]').check();
    assert.equal(await companySummary.textContent(),'Telescope');
    assert.match(await companySummary.getAttribute('aria-label'),/^Company filter: Telescope$/);
    await filters.locator('#q-company').fill('Engineering');
    await filters.locator('#list-company input[value="Engineering Company"]').check();
    assert.equal(await companySummary.textContent(),'(2) Companies');
    await companySummary.press('Escape');
    await filters.reload();await filters.locator('.job').first().waitFor();
    assert.equal(await companySummary.textContent(),'(2) Companies','URL restoration keeps the count and category');
    assert.equal(await filters.locator('#advanced-filter-label').textContent(),'Advanced filters (1)');
    await filters.locator('#detail-match .resume-picker').waitFor();
    await filters.screenshot({path:path.join(artifactDir,'filters-primary-desktop.png')});
    await advancedToggle.click();
    await filters.screenshot({path:path.join(artifactDir,'filters-compact-desktop.png')});
    await filters.locator('#advanced-filter-done').click();
    assert.equal(await advancedToggle.evaluate(el=>el===document.activeElement),true,'Done restores focus');
    assert.equal(await filters.locator('#advanced-filters').evaluate(el=>el.open),false);
    await filters.locator('#reset-filters').click();
    assert.equal(await companySummary.textContent(),'Company');
    await advancedToggle.click();
    await posted.focus();await posted.press('ArrowDown');
    await filters.locator('#date-select + details [role="option"]').first().waitFor();
    await filters.keyboard.press('ArrowDown');await filters.keyboard.press('Enter');
    assert.equal(await posted.textContent(),'Last 7 days','keyboard selection shows the selected date');
    assert.equal(await filters.locator('#date-select').inputValue(),'7');
    await salary.click();
    await filters.locator('#salary-select + details').getByRole('option',{name:'$150k+',exact:true}).click();
    assert.equal(await salary.textContent(),'$150k+');
    await filters.locator('#advanced-filter-reset').click();
    assert.equal(await filters.locator('#advanced-filter-label').textContent(),'Advanced filters');
    assert.equal(await posted.textContent(),'Posted');assert.equal(await salary.textContent(),'Salary');
    await filters.setViewportSize({width:390,height:844});
    await filters.goto(base+'/index.html');await filters.locator('.job').first().waitFor();
    await filters.locator('#mobile-filter-toggle').click();
    await advancedToggle.click();
    await companySummary.click();
    await filters.locator('#list-company input[value="Telescope"]').check();
    assert.equal(await companySummary.textContent(),'Telescope');
    await companySummary.click();
    await filters.screenshot({path:path.join(artifactDir,'filters-compact-mobile.png')});
    assert.ok(await filters.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'compact filters fit on mobile');
    await filters.locator('#advanced-filter-reset').click();
    await filters.locator('#filter-drawer-close').click();
    assert.equal(await companySummary.textContent(),'Company','reset updates the closed mobile drawer');
    // Search and main filters stay visible; the inspector clears the pinned bar.
    for(const width of [1440,1280]) {
      await filters.setViewportSize({width,height:width===1440?900:800});
      await filters.goto(base);await filters.locator('#detail-title').waitFor();
      await filters.evaluate(()=>scrollTo(0,800));
      await filters.waitForFunction(()=>Math.abs(document.querySelector('#job-controls').getBoundingClientRect().top)<1);
      await filters.waitForFunction(()=>{
        const controls=document.querySelector('#job-controls').getBoundingClientRect();
        return document.querySelector('#job-detail').getBoundingClientRect().top>=controls.bottom;
      });
      assert.ok(await filters.locator('#job-search').isVisible());
      await advancedToggle.click();
      const pinnedPanel=await filters.locator('#advanced-panel').boundingBox();
      assert.ok(pinnedPanel.y+pinnedPanel.height<=filters.viewportSize().height,'advanced popover fits below the pinned filters');
      await filters.screenshot({path:path.join(artifactDir,`sticky-filters-${width}.png`)});
      await filters.locator('#advanced-filter-done').click();
      await filters.locator('#sum-role').click();
      await filters.locator('#list-role input').first().waitFor({state:'visible'});
      await filters.locator('#sum-role').click();
      await filters.locator('#job-search').fill('Platform 7');
      await filters.waitForFunction(()=>document.querySelector('#job-count').textContent.includes('11 matching roles'));
      assert.equal(await filters.locator('#job-controls').evaluate(el=>getComputedStyle(el).position),'sticky');
    }
    await filters.close();
    console.log('Compact filters passed: placeholders, single and multiple selections, search, reload, reset, keyboard and mobile.');
    console.log('Mobile Back passed: list/search/scroll/focus restoration, Forward, reload, in-app Back, Escape, Companies state and normal page navigation.');
    console.log('Pane-only resumes passed: no Resumes section, upload, cancellation, failure retry and removal from the description pane.');
    assert.deepEqual(errors,[]);
    console.log('Reading layout:',JSON.stringify(readingMeasurements));
    console.log('One-click JD UX passed: cached/automatic results, request counts, retained updates, resume switching, zero demonstrated, mapping, scrolling, pagination, management, states and mobile.');
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
