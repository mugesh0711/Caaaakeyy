var one = document.querySelector(".one")
var two = document.querySelector(".two")
one.addEventListener("click",function change(){
    window.location.href="sign.html";
})
two.addEventListener("click",function scrolldown(){
    document.querySelector(".inn").scrollIntoView
    ({
        behavior:"smooth"
    });
}
)