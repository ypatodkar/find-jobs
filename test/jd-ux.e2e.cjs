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
let resumePostCalls=0,resumeDeleteCalls=0,resumeWriteError=false;
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
      resumePostCalls++;
      if(resumeWriteError)return json({error:'Resume upload temporarily unavailable.'},503);
      const uploaded={id:'r_uploaded',label:'Uploaded resume'};
      uploadedResumes=[uploaded,...uploadedResumes.filter(r=>r.id!==uploaded.id)];removedResumeIds.delete(uploaded.id);
      return json({resume:uploaded});
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
    page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    const waitScore=async(score)=>{await page.waitForFunction(n=>document.querySelector('.analysis-score-number')?.textContent===`${n}/100`,score);await page.getByRole('button',{name:'Reanalyze',exact:true}).waitFor();};
    const open=async()=>{await page.goto(base);await page.locator('.job[data-job-id="job_0"]').click();};
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
      assert.equal(layout.font,'16px');
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
    assert.equal(await page.locator('.analysis-settings select').count(),0,'Manage contains resume management only');
    await page.locator('.analysis-header-picker .select-picker > summary').click();
    await page.getByRole('option',{name:'Data resume',exact:true}).click();await waitScore(60);
    assert.equal(await down.getAttribute('aria-pressed'),'false','a different resume does not inherit the review');
    await page.locator('.analysis-header-picker .select-picker > summary').click();
    await page.getByRole('option',{name:'Systems resume',exact:true}).click();await waitScore(20);
    assert.equal(await down.getAttribute('aria-pressed'),'true','returning to the original resume restores its review');
    const layout=await page.evaluate(()=>{
      const a=document.querySelector('.results-main'),b=document.querySelector('.job-detail');
      return {ratio:a.clientWidth/(a.clientWidth+b.clientWidth),leftOverflow:getComputedStyle(a).overflowY,rightOverflow:getComputedStyle(b).overflowY,analysis:document.querySelector('#detail-match').offsetHeight};
    });
    assert.ok(Math.abs(layout.ratio-0.42)<0.025);assert.equal(layout.leftOverflow,'visible','the list scrolls with the page, footer after it');assert.equal(layout.rightOverflow,'auto');assert.ok(layout.analysis<540,'analysis is bounded without oversized cards');
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
    await page.mouse.move(handle.x+handle.width/2+160,handle.y+80,{steps:6});await page.mouse.up();
    const afterResize=await widths();
    assert.ok(afterResize.list>beforeResize.list+150 && afterResize.detail<beforeResize.detail-150,'dragging adjusts both column widths');
    assert.equal(postCalls,resizeCalls);assert.equal(getCalls,resizeGets,'resizing does not reload analysis');
    assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
    assert.equal(await page.locator('.job-detail').evaluate(el=>el.scrollTop),0);
    await page.screenshot({path:path.join(artifactDir,'desktop-resized.png')});
    await separator.press('ArrowLeft');assert.ok((await widths()).list<afterResize.list-20);
    await separator.press('Home');assert.ok(Math.abs((await widths()).list-350)<1);
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
    assert.ok(Math.abs((await widths()).list/((await widths()).list+(await widths()).detail)-0.42)<0.005,'double-click restores the default width');
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
    await page.getByRole('option',{name:'Data resume',exact:true}).waitFor();
    await page.screenshot({path:path.join(artifactDir,'desktop-resume-picker.png')});
    await page.getByRole('option',{name:'Data resume',exact:true}).press('Enter');
    assert.equal(await page.locator('.analysis-score-number').count(),0,'old resume score disappears immediately');
    assert.equal(await page.locator('.jd-mark').count(),0);
    await waitScore(60);
    assert.equal(postCalls,savedSwitchCalls,'selecting a resume with a saved analysis makes no model request');
    assert.deepEqual(await page.locator('.analysis-metrics strong').allTextContents(),['2','0','0']);
    assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
    assert.equal(await page.locator('.analysis-header-picker .select-picker > summary').textContent(),'Data resume');
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
    const beforePage=await page.locator('.job-detail').evaluate(el=>el.scrollTop);
    await page.locator('.page-next').click();assert.equal(new URL(page.url()).searchParams.get('page'),'2');
    assert.equal(await page.locator('.job-detail').evaluate(el=>el.scrollTop),beforePage);
    await page.goBack();await page.waitForURL(base+'/');await page.goForward();await page.waitForURL(base+'/?page=2');
    // A single click from the unanalyzed state immediately exposes score + findings.
    mode='unanalyzed';postScore=20;await page.evaluate(()=>localStorage.setItem('find-jobs-active-resume','r_systems'));
    await open();await page.getByRole('button',{name:'Analyze resume',exact:true}).waitFor();
    assert.equal(await page.locator('#match-resume').inputValue(),'r_systems');
    assert.equal(await page.locator('.analysis-score-number').count(),0);
    assert.equal(await page.locator('.description-controls').isVisible(),false,'highlights are offered only after analysis');
    const entryHeading=await page.locator('.analysis-entry h3').boundingBox();
    const analyzeButton=await page.getByRole('button',{name:'Analyze resume',exact:true}).boundingBox();
    assert.ok(analyzeButton.y >= entryHeading.y+entryHeading.height,'Analyze resume sits below Resume match');
    assert.ok(Math.abs(analyzeButton.x-entryHeading.x)<2,'Analyze resume aligns with the heading');
    await page.screenshot({path:path.join(artifactDir,'desktop-entry.png')});
    await page.getByRole('button',{name:'Analyze resume',exact:true}).press('Shift+Tab');
    assert.equal(await page.locator('.analysis-more > summary').evaluate(el=>el===document.activeElement),true);
    await page.locator('.analysis-more > summary').press('Enter');
    await page.waitForFunction(()=>document.querySelector('.analysis-more > summary').getAttribute('aria-expanded')==='true');
    assert.equal(await page.locator('.resume-menu-header strong').textContent(),'Systems resume');
    await page.screenshot({path:path.join(artifactDir,'desktop-entry-options.png')});
    await page.locator('.analysis-more > summary').press('Escape');
    assert.equal(await page.locator('.analysis-more').evaluate(el=>el.open),false);
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
    await page.locator('.analysis-more > summary').click();await page.locator('.analysis-more > summary').press('Escape');
    assert.equal(await page.locator('#job-detail').isVisible(),true);
    await page.locator('#detail-top').getByRole('button',{name:'Back to jobs',exact:true}).click();assert.equal(await page.locator('#job-detail').isVisible(),false);
    mode='unanalyzed';await open();await page.getByRole('button',{name:'Analyze resume',exact:true}).waitFor();
    assert.equal(await page.locator('.analysis-feedback').count(),0,'unanalysed jobs do not show review controls');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(artifactDir,'mobile-entry.png')});
    await page.locator('.analysis-more > summary').click();
    const entryMenu=await page.locator('.analysis-settings').boundingBox();
    assert.ok(entryMenu.x>=0 && entryMenu.x+entryMenu.width<=390,'Resume options stay inside the mobile viewport');
    await page.screenshot({path:path.join(artifactDir,'mobile-entry-options.png')});
    await page.locator('.analysis-more > summary').click();
    for(const state of ['no-resume','error','signed-out','no-description']){
      mode=state;await open();
      const expected=state==='no-resume'?'Upload resume':state==='error'?'Storage temporarily unavailable.':state==='signed-out'?'Sign in to analyze your resume.':'This job has no description to compare against.';
      await page.locator('#detail-match').getByText(expected,{exact:state!=='error'}).waitFor();assert.equal(await page.locator('#detail-body').isVisible(),true);
      if(state==='no-resume') {
        await page.locator('#detail-match input[type="file"]').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Built and operated backend services, improved reliability and maintained automated tests. Collaborated with engineering teams to deliver production APIs.')});
        await waitScore(20);await page.locator('.analysis-more > summary').click();
        page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Remove this resume',exact:true}).click();
        assert.ok((await page.locator('.analysis-source').textContent()).includes('Uploaded resume'),'canceling removal preserves the selected resume');
        page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Remove this resume',exact:true}).click();
        await page.getByRole('button',{name:'Upload resume',exact:true}).waitFor();assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
      }
    }
    mode='normal';postScore=74;
    await page.evaluate(()=>localStorage.setItem('find-jobs-active-resume','r_systems'));
    await open();await waitScore(20);
    await page.locator('.analysis-header-picker .select-picker > summary').click();
    await page.getByRole('option',{name:'Frontend resume',exact:true}).click();
    await page.getByRole('button',{name:'Analyze resume',exact:true}).waitFor();
    assert.equal(await page.locator('#match-resume').inputValue(),'r_frontend');
    assert.equal(await page.locator('.analysis-score-number').count(),0,'switching to an unscored resume clears the old score');
    assert.equal(await page.locator('.jd-mark').count(),0);
    assert.equal(await page.locator('.analysis-header-picker').isVisible(),true,'the selector stays in the header for the new analysis');
    assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
    await page.getByText('Not analyzed',{exact:true}).waitFor();
    await page.screenshot({path:path.join(artifactDir,'mobile-resume-switched.png')});
    const newResumeCalls=postCalls;
    await page.getByRole('button',{name:'Analyze resume',exact:true}).click();await waitScore(74);
    assert.equal(await down.getAttribute('aria-pressed'),'false','new analyses start unrated');
    assert.equal(postCalls,newResumeCalls+1);assert.equal(lastPost.resume_id,'r_frontend');assert.equal(lastPost.force,false);
    const cachedSwitchGets=getCalls,cachedSwitchPosts=postCalls;
    await page.locator('.analysis-header-picker .select-picker > summary').click();
    await page.getByRole('option',{name:'Systems resume',exact:true}).click();await waitScore(20);
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
    const library=page.locator('#resume-library');
    await library.locator('.resume-library-select').first().waitFor();
    assert.equal(await library.locator('.resume-library-select').count(),3,'the resume library is available before opening a job');
    const toolbarLayout=await page.evaluate(()=>{
      const filters=document.querySelector('.filter-primary').getBoundingClientRect();
      const library=document.querySelector('#resume-library').getBoundingClientRect();
      return {sideBySide:filters.right<library.left,search:document.querySelector('.search-wrap').getBoundingClientRect().width,toolbar:document.querySelector('#job-controls').clientWidth};
    });
    assert.equal(toolbarLayout.sideBySide,true,'filters sit to the left of the resume column');
    assert.ok(toolbarLayout.search<toolbarLayout.toolbar*.3,'the search field is narrower');
    await page.screenshot({path:path.join(artifactDir,'resume-library-1440.png')});
    const beforeLibraryPosts=postCalls;
    await library.locator('[data-library-act="select"][data-resume-id="r_data"]').click();
    await page.locator('.job[data-job-id="job_0"]').click();await waitScore(60);
    assert.equal(await page.locator('#match-resume').inputValue(),'r_data','library selection is used by the inspector');
    await library.locator('[data-library-act="select"][data-resume-id="r_systems"]').click();await waitScore(20);
    assert.equal(postCalls,beforeLibraryPosts,'choosing a resume reuses its saved analysis');
    const fixtureFile={name:'library-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Built and operated backend services, improved reliability and maintained automated tests. Collaborated with engineering teams to deliver production APIs.')};
    const uploadInput=library.locator('input[type="file"]');
    const beforeUploads=resumePostCalls;
    await uploadInput.setInputFiles(fixtureFile);
    await page.getByRole('button',{name:'Analyze resume',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('.resume-library-add').disabled);
    assert.equal(await library.locator('.resume-library-select').count(),4,'adding a resume updates the library');
    assert.equal(await page.locator('#match-resume').inputValue(),'r_uploaded','a new upload becomes the active resume');
    assert.equal(resumePostCalls,beforeUploads+1);assert.equal(postCalls,beforeLibraryPosts,'library uploads do not trigger paid analysis');
    assert.equal(await page.locator('#detail-title').textContent(),'Senior Software Engineer');
    const beforeDeletes=resumeDeleteCalls;
    page.once('dialog',dialog=>dialog.dismiss());await library.getByRole('button',{name:'Remove Uploaded resume',exact:true}).click();
    assert.equal(resumeDeleteCalls,beforeDeletes,'cancelled removal makes no request');
    resumeWriteError=true;page.once('dialog',dialog=>dialog.accept());await library.getByRole('button',{name:'Remove Uploaded resume',exact:true}).click();
    await library.getByText('Resume removal temporarily unavailable.',{exact:true}).waitFor();
    assert.equal(await library.locator('.resume-library-select').count(),4,'a failed removal retains the resume');
    resumeWriteError=false;page.once('dialog',dialog=>dialog.accept());await library.getByRole('button',{name:'Remove Uploaded resume',exact:true}).click();
    await waitScore(20);await page.waitForFunction(()=>!document.querySelector('.resume-library-add').disabled);
    assert.equal(await library.locator('.resume-library-select').count(),3);
    assert.equal(await page.locator('#match-resume').inputValue(),'r_systems','removing the active resume selects a remaining resume');
    for(const width of [1280,800]){
      await page.setViewportSize({width,height:900});await page.goto(base);await library.locator('.resume-library-select').first().waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(artifactDir,'resume-library-'+width+'.png')});
    }
    await page.setViewportSize({width:390,height:844});await page.goto(base);
    await page.locator('#mobile-filter-toggle').click();await library.locator('.resume-library-select').first().waitFor();
    await library.scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#job-controls').evaluate(el=>el.scrollWidth<=el.clientWidth),'the mobile drawer has no horizontal overflow');
    await page.screenshot({path:path.join(artifactDir,'resume-library-mobile.png')});
    await library.locator('[data-library-act="select"][data-resume-id="r_data"]').click();
    await page.locator('#filter-drawer-close').click();await page.locator('.job[data-job-id="job_0"]').click();await waitScore(60);
    assert.equal(await page.locator('#match-resume').inputValue(),'r_data','mobile library selection reaches the JD');
    console.log('Resume library passed: independent management, synced selection, upload, cancellation, failure retry, removal and responsive layout.');
    assert.deepEqual(errors,[]);
    console.log('Reading layout:',JSON.stringify(readingMeasurements));
    console.log('One-click JD UX passed: cached/automatic results, request counts, retained updates, resume switching, zero demonstrated, mapping, scrolling, pagination, management, states and mobile.');
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
