/** Administrator-only reusable rosters. Copies contain identities, never attendance. */
const RosterManager = {
  rosters:[],draft:null,target:'template',dirty:false,
  people(rows) { return rows.map(p=>({department:String(p.department||''),name:String(p.name||''),position:String(p.position||'')})); },
  reset() {
    this.rosters=[];this.draft=null;this.dirty=false;App.rosterDirty=false;
    document.getElementById('modal-roster-manager')?.classList.add('hidden');
    document.getElementById('roster-editor-body')?.replaceChildren();
  },
  markDirty(){this.dirty=true;App.rosterDirty=true;},
  confirmDiscard(){return !this.dirty || confirm('저장하지 않은 명단 변경을 버릴까요?');},
  async refresh() {
    App.requireAdmin();
    this.rosters=App.localMode?JSON.parse(localStorage.getItem('eSign_basicRosters')||'[]'):await GasSync.listRosters();
    if(!Array.isArray(this.rosters))throw new Error('기본명단을 불러오지 못했습니다.');
    const select=document.getElementById('saved-roster-select');select.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='기본명단 선택';select.appendChild(empty);
    for(const roster of this.rosters){const option=document.createElement('option');option.value=roster.id;option.textContent=roster.name+' ('+roster.attendees.length+'명)';select.appendChild(option);}
  },
  async open(target='template') {
    App.requireAdmin();
    if(!this.confirmDiscard())return;
    if(target==='bundle'&&!AppState.currentBundle)throw new Error('연수를 먼저 선택하세요.');
    await this.refresh();this.target=target;
    this.draft=target==='bundle'?JSON.parse(JSON.stringify(AppState.currentBundle)):
      {id:'roster_'+GasSync.randomHex(16),name:'기본명단'+(this.rosters.length+1),attendees:[]};
    this.dirty=false;App.rosterDirty=true;this.render();
    document.getElementById('modal-roster-manager').classList.remove('hidden');
  },
  render() {
    document.getElementById('roster-manager-title').textContent=this.target==='bundle'?'이번 연수 명단 수정':'기본명단 관리';
    document.getElementById('roster-editor-name').value=this.draft.name;
    document.getElementById('roster-editor-name').disabled=this.target==='bundle';
    document.getElementById('roster-template-controls').classList.toggle('hidden',this.target==='bundle');
    document.getElementById('roster-apply-controls').classList.toggle('hidden',this.target==='bundle');
    document.getElementById('btn-roster-delete').disabled=!this.draft.revision && !this.rosters.some(r=>r.id===this.draft.id);
    const body=document.getElementById('roster-editor-body');body.replaceChildren();
    this.draft.attendees.forEach((person,index)=>{
      const row=document.createElement('tr');
      for(const field of ['department','name','position']){
        const cell=document.createElement('td'),input=document.createElement('input');
        input.value=person[field]||'';input.maxLength=100;input.setAttribute('aria-label',(index+1)+'행 '+({department:'소속',name:'성명',position:'직급'}[field]));
        input.addEventListener('input',()=>{person[field]=input.value;this.markDirty();});cell.appendChild(input);row.appendChild(cell);
      }
      const cell=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.textContent='삭제';
      remove.addEventListener('click',()=>{
        if(App.busy)return;
        if(this.target==='bundle'&&person.signedAt&&!confirm('이 사람의 서명·사유도 삭제됩니다. 계속할까요?'))return;
        this.draft.attendees.splice(index,1);this.markDirty();this.render();
      });cell.appendChild(remove);row.appendChild(cell);body.appendChild(row);
    });
    document.getElementById('roster-editor-count').textContent=this.draft.attendees.length+'명';
  },
  validate() {
    this.draft.name=document.getElementById('roster-editor-name').value.trim();
    if(!this.draft.name)throw new Error('명단 이름을 입력하세요.');
    if(this.draft.attendees.length>200)throw new Error('명단은 최대 200명입니다.');
    for(const p of this.draft.attendees){
      p.name=(p.name||'').trim();p.department=(p.department||'').trim();p.position=(p.position||'').trim();
      if(!p.name)throw new Error('성명이 비어 있는 행을 입력하거나 삭제하세요.');
    }
  },
  async save() {
    App.requireAdmin();this.validate();
    if(this.target==='bundle'){
      if(AppState.currentBundle?.id!==this.draft.id)throw new Error('선택한 연수가 달라졌습니다. 다시 열어 주세요.');
      const changed=this.draft.attendees.filter(p=>AppState.currentBundle.attendees.some(old=>old.id===p.id&&(old.name!==p.name||old.department!==p.department)));
      if(changed.length&&!confirm('성명·소속이 바뀐 사람은 교체 인원으로 처리하여 기존 서명·사유를 비웁니다. 계속할까요?'))return;
      changed.forEach(p=>Object.assign(p,{id:'att_'+GasSync.randomHex(16),signatureData:null,signedAt:null,isSigned:false,status:'미서명',note:''}));
      const saved=App.localMode?this.draft:(await GasSync.syncBundle(this.draft)).bundle;
      App.acceptBundle(saved);this.draft=JSON.parse(JSON.stringify(saved));
      App.renderParticipantView();App.renderAdminOverview();
    } else {
      // Strip signatures/status even if this draft originated from an attendance bundle.
      const roster={...this.draft,attendees:this.people(this.draft.attendees)};
      let saved;
      if(App.localMode){
        saved={...roster,revision:(roster.revision||0)+1};
        localStorage.setItem('eSign_basicRosters',JSON.stringify(this.rosters.filter(r=>r.id!==saved.id).concat(saved)));
      } else saved=(await GasSync.saveRoster(roster)).roster;
      this.draft=saved;await this.refresh();document.getElementById('saved-roster-select').value=saved.id;
    }
    this.dirty=false;this.render();App.message(this.target==='bundle'?'이번 연수 명단을 저장했습니다.':'기본명단을 저장했습니다. 이미 진행 중인 연수에는 영향을 주지 않습니다.');
  },
  loadSelected(){
    if(!this.confirmDiscard())return;
    const roster=this.rosters.find(r=>r.id===document.getElementById('saved-roster-select').value);
    if(!roster)throw new Error('기본명단을 선택하세요.');
    this.draft=JSON.parse(JSON.stringify(roster));this.dirty=false;this.render();
  },
  async apply() {
    App.requireAdmin();
    if(this.target!=='template'||!AppState.currentBundle)throw new Error('적용할 연수를 먼저 선택하세요.');
    if(this.dirty)throw new Error('기본명단을 먼저 저장하세요.');
    const saved=this.rosters.find(r=>r.id===this.draft.id);
    if(!saved)throw new Error('기본명단을 먼저 저장하세요.');
    const replace=document.getElementById('roster-apply-mode').value==='replace';
    if(replace && AppState.currentBundle.attendees.length && !confirm('이번 연수의 기존 명단과 서명·사유를 모두 교체할까요?'))return;
    const people=this.people(saved.attendees).map(p=>({...p,id:'att_'+GasSync.randomHex(16),status:'미서명',note:'',signatureData:null,signedAt:null,isSigned:false}));
    await App.editBundle(b=>{b.attendees=replace?people:b.attendees.concat(people);});
    App.message('기본명단을 이번 연수에 복사했습니다. [이번 연수 명단 수정]에서 일부 인원을 추가·수정·삭제할 수 있습니다.');
    this.close();
  },
  async remove() {
    App.requireAdmin();
    if(!confirm('이 기본명단을 삭제할까요? 기존 연수 명단은 유지됩니다.'))return;
    const saved=this.rosters.find(r=>r.id===this.draft.id);if(!saved)throw new Error('저장된 기본명단을 선택하세요.');
    if(App.localMode)localStorage.setItem('eSign_basicRosters',JSON.stringify(this.rosters.filter(r=>r.id!==saved.id)));
    else await GasSync.deleteRoster(saved);
    this.dirty=false;await this.open();
  },
  close() {if(App.busy&&this.dirty)return;if(!this.confirmDiscard())return;this.dirty=false;App.rosterDirty=false;document.getElementById('modal-roster-manager').classList.add('hidden');},
  init() {
    const on=(id,fn)=>document.getElementById(id)?.addEventListener('click',()=>App.perform(fn));
    on('btn-basic-rosters',()=>this.open());
    on('btn-basic-rosters-home',()=>this.open());
    on('btn-edit-bundle-roster',()=>this.open('bundle'));
    on('btn-roster-refresh',async()=>{if(this.confirmDiscard()){this.dirty=false;await this.refresh();}});
    on('btn-roster-open',()=>this.loadSelected());
    on('btn-roster-new',()=>{if(!this.confirmDiscard())return;this.draft={id:'roster_'+GasSync.randomHex(16),name:'기본명단'+(this.rosters.length+1),attendees:[]};this.dirty=false;this.render();});
    on('btn-roster-from-bundle',()=>{
      if(!AppState.currentBundle)throw new Error('연수를 먼저 선택하세요.');
      if(!this.confirmDiscard())return;
      this.draft={id:'roster_'+GasSync.randomHex(16),name:'기본명단'+(this.rosters.length+1),attendees:this.people(AppState.currentBundle.attendees)};
      this.markDirty();this.render();
    });
    on('btn-roster-add-row',()=>{
      if(this.draft.attendees.length>=200)throw new Error('최대 200명입니다.');
      this.draft.attendees.push({id:'att_'+GasSync.randomHex(16),department:'',name:'',position:'',status:'미서명',note:'',signatureData:null,signedAt:null,isSigned:false});
      this.markDirty();this.render();
    });
    on('btn-roster-save',()=>this.save());on('btn-roster-apply',()=>this.apply());on('btn-roster-delete',()=>this.remove());
    document.getElementById('btn-roster-close').addEventListener('click',()=>{if(!App.busy)this.close();});
    document.getElementById('roster-editor-name').addEventListener('input',()=>{this.draft.name=document.getElementById('roster-editor-name').value;this.markDirty();});
  }
};
window.RosterManager=RosterManager;

