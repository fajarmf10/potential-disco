// for animate hamburger menu
(function($){
  "use strict";

  var toggles = document.querySelectorAll(".c-hamburger");
  
  for (var i = toggles.length - 1; i >= 0; i--) {
  var toggle = toggles[i];
  toggleHandler(toggle);
  };
  
  function toggleHandler(toggle) {
  toggle.addEventListener( "click", function(e) {
    e.preventDefault();
    (this.classList.contains("is-active") === true) ? this.classList.remove("is-active") : this.classList.add("is-active");
  });
  }
  
})(jQuery);
// end of animate hamburger menu

// lazyload
const observer = lozad('.lozad');
observer.observe();

$(document).ready(function() {

	$("[data-fancybox]").fancybox({
		touch:false
	});

	if ( $(window).scrollTop() > 50 ) {
		// do something
		$("#web-header").addClass("stuck");
		$("#category-megadropdown").addClass("stuck");
	} else {
		$("#web-header").removeClass("stuck");
		$("#category-megadropdown").removeClass("stuck");
	}
	
	$(window).on('scroll', function() {
		var scrollTop = $(this).scrollTop();
		
		if ( scrollTop > 50 ) {
			// do something
			$("#web-header").addClass("stuck");
			$("#category-megadropdown").addClass("stuck");
		} else {
			$("#web-header").removeClass("stuck");
			$("#category-megadropdown").removeClass("stuck");
		}
	});

	// start of carousel section
	$('.collection-carousel').slick({
		dots: false,
		arrows: false,
		slidesToShow: 3,
		slidesToScroll: 1,
		infinite: true,
		speed: 300,
		autoplay: true,
		adaptiveHeight: true,
		responsive: [
		    {
		      breakpoint: 540,
		      settings: {
		        slidesToShow: 2
		      }
		    }
		]
	});
	$('.featured-carousel').slick({
		dots: true,
		arrows: false,
		slidesToShow: 3,
		slidesToScroll: 3,
		infinite: true,
		adaptiveHeight: true,
		responsive: [
		    {
		      breakpoint: 768,
		      settings: {
		        slidesToShow: 2,
		        slidesToScroll: 2
		      }
		    },
		    {
		      breakpoint: 540,
		      settings: {
		        slidesToShow: 1,
		        slidesToScroll: 1
		      }
		    }
		]
	});

	$('.nearby-carousel').slick({
		dots: true,
		arrows: false,
		slidesToShow: 1,
		slidesToScroll: 1,
		infinite: true,
		speed: 300,
		autoplay: true,
		adaptiveHeight: true
	});
	
	// end of carousel section

	// mobile menu
	$(document).on('click','#toggle-mmenu', function(e){
		if( $("#mobile-menu-container").hasClass("opened") ) {
			$("#mobile-menu-container").removeClass("opened");
		} else {
			$("#mobile-menu-container").addClass("opened");
		}
		e.preventDefault();
	});
	$(document).on('click','#mobile-menu-container .hidden-close-menu', function(e){
		$("#mobile-menu-container").removeClass("opened");
		$(".c-hamburger").removeClass("is-active");
		e.preventDefault();
	});

	$(document).on('click','.hm-right .has-dropdown > a', function(e){
		if($(this).hasClass("opened")) {
			$(this).removeClass("opened");
		} else {
			$('.hm-right .has-dropdown > a').removeClass("opened");
			$(this).addClass("opened");
		}
		e.preventDefault();
	});
	$(document).on('click','.hm-top .has-dropdown > a', function(e){
		if($(this).hasClass("opened")) {
			$(this).removeClass("opened");
		} else {
			$('.hm-right .has-dropdown > a').removeClass("opened");
			$(this).addClass("opened");
		}
		e.preventDefault();
	});

	$(document).on('click','.toggle-mlang', function(e){
		if($(this).hasClass("opened")) {
			$(this).removeClass("opened");
			$(".hidden-lang").slideUp("fast");
		} else {
			$(this).addClass("opened");
			$('.toggle-macc').removeClass("opened");
			$(".hidden-acc").slideUp("fast");
			$(".hidden-lang").slideDown("fast");
		}
		e.preventDefault();
	});
	$(document).on('click','.toggle-macc', function(e){
		if($(this).hasClass("opened")) {
			$(this).removeClass("opened");
			$(".hidden-acc").slideUp("fast");
		} else {
			$(this).addClass("opened");
			$('.toggle-mlang').removeClass("opened");
			$(".hidden-lang").slideUp("fast");
			$(".hidden-acc").slideDown("fast");
		}
		e.preventDefault();
	});

	// mobile user dropdown
	$(document).on('click', '.user-toggle', function(e){
		if ($('.user-mobile').hasClass('active')) {
			$('.user-mobile').removeClass('active');
		} else {
			$('.user-mobile').addClass('active');
		}
		e.preventDefault();
	});

	// mobile category menu
	$(document).on('click','#mobile-category-menu li.has-sub > a', function(e){
		if($(this).hasClass("opened")) {
			$(this).removeClass("opened");
			$(this).next(".sub-nav").slideUp("fast");
		} else {
			$(this).addClass("opened");
			$(this).next(".sub-nav").slideDown("fast");
		}
		e.preventDefault();
	});

	// desktop menu hover effect
	$(document).on('mouseenter','.desktop-main-nav > .item.has-sub > a', function (event) {
	    $(this).parents(".desktop-main-nav").children(".item").children("a").removeClass("active");
	    $(this).addClass("active");
	    $(".header-menu-mask").addClass("active");
	});
	$(document).on('mouseleave','.desktop-main-nav .has-sub', function (event) {
	    $(this).parents(".desktop-main-nav").children(".item").children("a").removeClass("active");
	    $(".header-menu-mask").removeClass("active");
	});

	$(document).on('click','.has-megaaa > a', function(e){
		if($(this).hasClass("opened")) {
			$(this).removeClass("opened");
		} else {
			$(this).parents(".desktop-main-nav").find(".has-mega").children("a").removeClass("opened");
			$(this).addClass("opened");
		}
		e.preventDefault();
	});

	// desktop language
	$(document).on('click', '.lang-toggle', function(e){
		if ($('.lang-desktop').hasClass('active')) {
			$('.lang-desktop').removeClass('active');
		} else {
			$('.logres').removeClass('active');
			$('.user-desktop').removeClass('active');
			$('.lang-desktop').addClass('active');
		}
		e.preventDefault();
	});
	// dekstop user dropdown
	$(document).on('click', '.user-toggle', function(e){
		if ($('.user-desktop').hasClass('active')) {
			$('.user-desktop').removeClass('active');
		} else {
			$('.lang-desktop').removeClass('active');
			$('.user-desktop').addClass('active');
		}
		e.preventDefault();
	});

	// tablet user dropdown
	$(document).on('click', '.logres .username', function(e){
		if ($('.logres').hasClass('active')) {
			$('.logres').removeClass('active');
		} else {
			$('.lang-desktop').removeClass('active');
			$('.logres').addClass('active');
		}
		e.preventDefault();
	});

	// search
	$(document).on('click','.toggle-search', function(e){
		$(".search-area-wrap").addClass("active");
		e.preventDefault();
	});
	$(document).on('click','.close-search-toggle', function(e){
		$(".search-area-wrap").removeClass("active");
		e.preventDefault();
	});

    $(document).on('click','.mobile-filter-toggle', function(e){
		$(".npc-left").addClass("opened");
		e.preventDefault();
	});
	// Important HACK for iOS 8 and above so the on click function works on non-link/button
	if( /iPhone|iPad|iPod|Opera Mini/i.test(navigator.userAgent) ) {
		// run your code here
		$('.npc-left').css('cursor','pointer');
	}
	$(document).on('click','.npc-left', function(e){
		if($(".npc-left").hasClass("opened")) {
		  // Check if click was triggered on or within #mobilemenu_content
		  if( $(e.target).closest(".npc-left-content").length > 0 ) {
		    
		  }
		  // Otherwise
		  // trigger your click function
		  else {
		    $(".npc-left").removeClass("opened");
		  }
		} else {

		}
		// jangan dikasih e.preventdefault supaya link bisa tetep jalan
	});

	// OPEN FILTER LIST
    $(".fc-toggle.opened").next(".fc-content").show();
    $(document).on('click','.fc-toggle', function(e){
    	var fcParent = $(this).parents(".filter-child");
		if(fcParent.hasClass("opened")) {
	    	fcParent.removeClass("opened");
	    	fcParent.find(".fc-content").slideUp("fast");
	    } else {
	    	$(".filter-child").removeClass("opened");
			fcParent.addClass("opened");
			$(".fc-content").slideUp("fast");
			fcParent.find(".fc-content").slideDown("fast");
	    }
		e.preventDefault();
	});

	$(".fc-toggle-parent.opened").next(".fc-content-parent").hide();
    $(document).on('click','.fc-toggle-parent', function(e){
    	var fcParent = $(this).parents(".filter-child-parent");
		if(fcParent.hasClass("opened")) {
	    	fcParent.removeClass("opened");
	    	fcParent.find(".fc-content-parent").slideUp("fast");
	    } else {
	    	$(".filter-child-parent").removeClass("opened");
			fcParent.addClass("opened");
			$(".fc-content-parent").slideUp("fast");
			fcParent.find(".fc-content-parent").slideDown("fast");
	    }
		e.preventDefault();
	});

	// ngc tabs
	$(document).on('click','.ngc-tabs a', function(e){
		var activeURL = $(this).attr("href");
		if( $(this).parent(".ngc-tabs").hasClass("clicked") ) {
			// tab dropdown lagi terbuka
			$(this).parent(".ngc-tabs").removeClass("clicked");
			$(this).parent(".ngc-tabs").find("a").removeClass("active");
			$(this).parents(".ngc-tab-wrap").find(".ngc-tab-container").removeClass("active");
			$(this).addClass("active");
			$(activeURL).addClass("active");
		} else {
			// tab dropdown masih tertutup
			if( $(this).hasClass("active") ) {
				$(".ngc-tabs").addClass("clicked");
			} else {
				$(this).parent(".ngc-tabs").find("a").removeClass("active");
				$(this).parents(".ngc-tab-wrap").find(".ngc-tab-container").removeClass("active");
				$(this).addClass("active");
				$(activeURL).addClass("active");
			}
		}
		e.preventDefault();
	});
	$(document).on('click','.prod-tab-wrap .ngc-tabs a', function(e){
		$('.tab-carousel-wrap .featured-carousel').slick("setPosition", 0);
		e.preventDefault();
	});

	//JUST NEEDED IN THE PAGE WHICH HAVE QUANTITY ATTRIBUTE
	/*
	// This button will increment the value
	// $(document).on('click','.plus', function(e){
	//   // Stop acting like a button
	//   e.preventDefault();
	//   // Get the field name
	//   fieldName = $(this).attr('field');
	//   // Get its current value
	//   var currentVal = parseInt($('input[name='+fieldName+']').val());
	//   // If is not undefined
	//   if (!isNaN(currentVal)) {
	//       // Increment
	//       $('input[name='+fieldName+']').val(currentVal + 1);
	//   } else {
	//       // Otherwise put a 0 there
	//       $('input[name='+fieldName+']').val(0);
	//   }
	// });
	// This button will decrement the value till 0
	// $(document).on('click','.minus', function(e){
	//   // Stop acting like a button
	//   e.preventDefault();
	//   // Get the field name
	//   fieldName = $(this).attr('field');
	//   // Get its current value
	//   var currentVal = parseInt($('input[name='+fieldName+']').val());
	//   // If it isn't undefined or its greater than 0
	//   if (!isNaN(currentVal) && currentVal > 0) {
	//       // Decrement one
	//       $('input[name='+fieldName+']').val(currentVal - 1);
	//   } else {
	//       // Otherwise put a 0 there
	//       $('input[name='+fieldName+']').val(0);
	//   }
	// });
	*/
	//JUST NEEDED IN THE PAGE WHICH HAVE QUANTITY ATTRIBUTE

	// moodboard
	$(document).on('mouseenter','.mb-dots', function (event) {
	    $(this).addClass("active");
	});
	$(document).on('mouseleave','.mb-dots', function (event) {
		var dis = $(this);
	   	setTimeout(function() {
			 dis.removeClass("active");
		}, 300);
	});

	// custom scrollbar
	$(".custom-scroll").mCustomScrollbar({
	  theme: "nuke",
	  autoHideScrollbar: true,
	  scrollbarPosition: "outside"
	});
    $(".custom-scroll-horisontal").mCustomScrollbar({
      theme: "nuke",
      axis: "x",
      autoHideScrollbar: true,
      scrollbarPosition: "outside"
    });
    $(".custom-scroll-xy").mCustomScrollbar({
      theme: "nuke",
      axis: "xy",
      autoHideScrollbar: true,
      scrollbarPosition: "outside"
    });

});
