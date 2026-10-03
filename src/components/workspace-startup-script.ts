// Runs during document parsing, before hydration.
export const workspaceStartupScript = `(function(){var r=document.documentElement;try{r.dataset.monsteraStartup=sessionStorage.getItem('monstera-workspace-intro-seen')==='1'?'skip':'start';}catch(e){r.dataset.monsteraStartup='start';}r.dataset.monsteraStartupAt=String(performance.now());})();`;
