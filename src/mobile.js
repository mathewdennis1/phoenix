function delay(n){
    return new Promise(function(resolve){
        setTimeout(resolve,n*1000);
    });
}

async function myAsyncFunction(){
    //Do what you want here 
    console.log("Before the delay")

    await delay(12);

    console.log("After the delay")
    //Do what you want here too
   var w = window.innerWidth;
   var h = window.innerHeight;
   if (w < 600 ) {
     styleChanger();
     addButton ();
  }
}

function styleChanger() {
  const element = document.getElementById("sidebar");
  if (element.className == "sidebar panel quiet-scrollbars horz-resizable right-resizer collapsible") {
    element.className = "sidebar panel quiet-scrollbars horz-resizable right-resizer collapsible sidebar-new";
  } 
};

myAsyncFunction();

function toggleSidebar() {
   const element = document.getElementById("sidebar");
  if (element.className == "sidebar panel quiet-scrollbars horz-resizable right-resizer collapsible sidebar-new") {
    element.className = "sidebar panel quiet-scrollbars horz-resizable right-resizer collapsible sidebar-open";
  }
   else if (element.className == "sidebar panel quiet-scrollbars horz-resizable right-resizer collapsible sidebar-open") {
    element.className = "sidebar panel quiet-scrollbars horz-resizable right-resizer collapsible sidebar-new";
  } 
};

function closeSidebar() {
   const element = document.getElementById("sidebar");
   if (element.className == "sidebar panel quiet-scrollbars horz-resizable right-resizer collapsible sidebar-open") {
    element.className = "sidebar panel quiet-scrollbars horz-resizable right-resizer collapsible sidebar-new";
  }
};

function addButton (){

	const openbtn = document.createElement("button");

	openbtn.innerHTML = '<button class="openbtn" onclick="toggleSidebar()">&#9776; </button>';

	document.getElementById("plugin-icons-bar").appendChild(openbtn);

	const closeIcon = document.createElement("a");

	closeIcon.innerHTML = '<a class="closebtn" onclick="closeSidebar()">&times;</a>';

	document.getElementById("mainNavBar").appendChild(closeIcon);
}



