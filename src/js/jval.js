jQuery.validator.addMethod("alphanumeric", function(value, element) {

//    return this.optional(element) || /^\w[\w\d\s]*$/.test(value);

return this.optional(element) || /^[0-9a-z-.,\s]+$/i.test(value);

	}, "Letters, numbers, spaces or underscores only");  

	

jQuery.validator.addMethod("alphanumeric2", function(value, element) {

//    return this.optional(element) || /^\w[\w\d\s]*$/.test(value);

return this.optional(element) || /^[0-9a-z_]+$/i.test(value);

	}, "Letters, numbers or underscores only");  

jQuery.validator.addMethod("alphanumeric3", function(value, element) {
//    return this.optional(element) || /^\w[\w\d\s]*$/.test(value);
return this.optional(element) || /^[0-9.]+$/i.test(value);
	}, "Number Only");  

jQuery.validator.addMethod("alphanumeric5", function(value, element) {
//    return this.optional(element) || /^\w[\w\d\s]*$/.test(value);
return this.optional(element) || /^[0-9.]+$/i.test(value);
	}, "Please Provide valid phone.");  


jQuery.validator.addMethod("abcval", function(value, element) {
        //return this.optional(element) || /^\w[\w\d\s]*$/.test(value);
        return this.optional(element) || /^[a-z A-Z.,-]+$/i.test(value);
        }, "Letters  only"); 

$().ready(function() {	

	/* ngc_master_item_storage_location */
    $("#change-location").validate({
        ignore: "",
        rules: { 

            location       : { required: true }
        
        },errorPlacement: function(error, element) {        
    
            if (element.is("#location")) { 
    
                $("#location_error").html(error);

            }else { element.next('span').html(error) }
        },   

        messages: {
            
            location      : { required:"Please choose the location" }

        }
    
    });

    /* ngc_login form  */
    $("#login_form").validate({
        
        ignore: "",
        rules: { 

            email         : { required: true, 
                              email:true },
            password      : { required: true, 
                              minlength: 6 }
        
        },   

        messages: {
            
             email      : { required:"Please enter your email address", 
                            email:"* Please enter a valid email address" },

             password   : { required:"Please enter your password", 
                            minlength: "* Please enter minimum 6 characters."}

        }
    
    });


    /* ngc_reset_password */
    $("#reset_password").validate({
        
        ignore: "",
        rules: { 

            email         : { required: true, 
                              email:true }
        
        },   

        messages: {
            
             email      : { required:"Please enter your email address", 
                            email:"* Please enter a valid email address" }

        }
    
    });

    /* ngc_reset_password */
    $("#reset_form").validate({
        
        ignore: "",
        rules: { 

            password        : { required: true, 
                                  minlength: 6 },

            confirm_password: { required: true, 
                                equalTo: "#password" }
        },   

        messages: {
            
            password        : { required:"Please enter your password", 
                                minlength: "* Please enter minimum 6 characters."},

            confirm_password: { required:"Please enter your password",
                                equalTo: "* Password not match, please enter same value"}
        }
    
    });


    /* Register Form */
    $("#register-form").validate({
        ignore: "",
        rules: {

            full_name     : { required: true, 
                              abcval : true },

            email         : { required: true, 
                              email:true },

            mobile_phone  : { required: true, 
                              digits:true,
                              minlength: 10 },

            identity_number: { required: true,
                                digits:true,
                            minlength:16,
                        maxlength:16 },

            // tax_number  : { required: true },

            password      : { required: true, 
                              minlength: 6 },

            confirm_password: { required: true, 
                                equalTo: "#password" },

            agreeTnc           : "required"


        },errorPlacement: function(error, element) {        
    
            if (element.is("#agreeTnc")) { 
    
                $("#agreeTnc_error").html(error);

            }
            else if(element.is("#mobile_phone")) { 
    
                $("#phone_error").html(error);

            }
            
            else { element.next('span').html(error) }
        },     

        messages: {

            full_name       : { required:"Please enter your name",
                                abcval:"Please enter only characters" },

            email           : { required:"Please enter your email address", 
                                email:"* Please enter a valid email address" },

            mobile_phone    : { required:"Please enter your phone", 
                                digits:"* Please enter only numbers.",
                                minlength: "* Your mobile phone number min 10 characters."},
            
            identity_number : { required:"Please enter your identity number", 
                                digits:"Please enter only numbers"},

            // tax_number            : { required:"Please enter your NPWP number", 
            //                     digits:"Please enter only numbers"},

            password        : { required:"Please enter your password", 
                                minlength: "* Please enter minimum 6 characters."},

            confirm_password: { required:"Please enter your password",
                                equalTo: "* Password not match, please enter same value"},

            agreeTnc        :  "Please agree with our Terms and Condition before proceeding"

        }

    });

    


    $("#newsletter-form").validate({
        ignore: "",
        rules: {

            email      : { required: true, email:true }
        
        },      

        messages: {
            
            email      : { required: "Please enter your email" }

        }
    
    });



    /* Contact Form */
    $("#contact_form").validate({
        ignore: "",
        rules: {

            full_name        : { required: true, 
                              abcval : true },

            email       : { required: true, 
                              email:true },

            phone       : { required: true, 
                              digits: true, 
                              minlength: 10 },

            subject     : { required: true },

            // tax_number  : { required: true },

            message      : { required: true }

        },     

        messages: {

            full_name            : { required:"Please enter your name",
                                abcval:"Please enter only characters" },

            email           : { required:"Please enter your email address", 
                                email:"* Please enter a valid email address" },

            phone           : { required:"Please enter your phone", 
                                digits:"* Please enter only numbers.",
                                minlength: "* Your mobile phone number min 10 characters."},
            
            subject         : { required:"Please enter your subject"},

            message        : { required:"Please enter your message"}

           
        }

    });

    $("#sell").validate({
        
        ignore: "",
        rules: {

            weight       : { required: true, 
                             number: true }
        
        },      

        messages: {
            
            weight       : { required:"Please enter your weight",
                             number:"Please enter only numbers" }

        }
    
    });

    $("#quick_buy").validate({
        
        ignore: "",
        rules: {

            budget       : { required: true, number: true  }
        
        },      

        messages: {
            
            budget       : { required:"Please enter your budget", 
                                number:"Please enter only numbers" }

        }
    
    });
    

    $("#search_q").validate({
        
        ignore: "",
        rules: {

            q       : { required: true }
        
        },      

        messages: {
            
            q       : { required:"Please enter your query" }

        }
    
    });
    
})