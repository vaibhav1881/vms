const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mariadb = require("mariadb");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const authController = require("./controllers/auth");

dotenv.config({ path: "./.env" });
const pool = require("./model/db"); // Database connection pool
const app = express();

app.set("view engine", "ejs");

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(express.json());
app.use(cookieParser());

// MariaDB CONNECTION-----------------------------------------------------------

pool.getConnection()
  .then(conn => {
    console.log("Connected to MariaDB!");
    conn.release(); // Release the connection when done
  })
  .catch(err => {
    console.error("Error connecting to MariaDB:", err);
    throw err;
  });

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});

//Some GLOBAL VARIABLES====================================================
let pincode;
(async () => {
  try {
    const result = await pool.query("SELECT pincode FROM location");
    pincode = result;
  } catch (err) {
    console.error("Error fetching pincode:", err);
    throw err;
  }
})();

let hospital;
(async () => {
  try {
    const result = await pool.query("SELECT H_name, H_address FROM hosp_data");
    hospital = result;
  } catch (err) {
    console.error("Error fetching hospital data:", err);
    throw err;
  }
})();

let vaccine;
(async () => {
  try {
    const result = await pool.query("SELECT V_name from vaccine");
    vaccine = result;
  } catch (err) {
    console.error("Error fetching vaccine data:", err);
    throw err;
  }
})();

/*****************************GET REQUESTS****************************/
/*********************************************************************/

// Add error handling to GET requests

let counts;
let vaccines;
app.get("/", async (req, res) => {
  try {
    const sql =
      "select ( select count(*) from vaccinates) as count_vacc, ( select count(*) from hosp_data) as count_hosp, ( select count(*) from inventory) as count_invent from dual;";
    const sqla =
      "SELECT count(*) as count_,h.H_vac from vaccinates as v INNER JOIN hosp_data as h WHERE v.Hosp=h.H_id GROUP By h.H_vac";
    const [resultCounts, resultVaccines] = await Promise.all([
      pool.query(sql),
      pool.query(sqla)
    ]);
    counts = resultCounts[0];
    vaccines = resultVaccines;
    res.render("home", { count: counts, vaccine: vaccines });
  } catch (err) {
    console.error("Error fetching data for home page:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Patient form get request
app.get("/patient", (req, res) => {
  try {
    res.render("patient", { pincodes: pincode, hospital: hospital });
  } catch (err) {
    console.error("Error rendering patient form:", err);
    res.status(500).send("Internal Server Error");
  }
});

//Stat page get request
app.get("/stat", async (req, res) => {
  try {
    const sql =
    "SELECT count(P_Gender) as count, ((count(P_Gender)*100)/(select count(*) from person)) as percentage, P_Gender FROM person GROUP By P_Gender";
  const sqli =
    "SELECT count(*) as count ,((count(H_type)*100)/(select count(*) from vacc_data)) as percentage,H_type FROM vacc_data GROUP By H_type;";
  const sqla =
    "SELECT count(*) as count ,((count(h_type)*100)/(select count(*) from hosp_data)) as percentage,H_type FROM hosp_data GROUP By h_type;";
  const sqlii =
    "select h_vac, count(*) as count, ((count(h_vac)*100)/(select count(*) from vacc_data)) as percentage from vacc_data group by h_vac;";
  const sqlb =
    "select (select count(*) from vaccinates where Date_first is not NULL and Date_second IS NULL) as onedose, (select count(*) from vaccinates where Date_first is not NULL and Date_second is not null) as twodose, (select count(*) from vaccinates where Date_first IS NULL and Date_second IS NULL) as nodose from dual;";
  
  const [resultGender, resultType, resultType2, resultVacc, resultDose] = await Promise.all([
    pool.query(sql),
    pool.query(sqli),
    pool.query(sqla),
    pool.query(sqlii),
    pool.query(sqlb)
  ]);

  res.render("stat", {
    gender: resultGender,
    type: resultType,
    type2: resultType2,
    vacc: resultVacc,
    dose: resultDose[0],
  });
  } catch (err) {
    console.error("Error fetching data for stat page:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Choose hospital during patient registration
app.get("/choose_hosp/:pin/:pid", async (req, res) => {
  try {
    const pri = await pool.query(
      "select check_priority(P_DOB) as priority from person where P_id = ?;",
      req.params.pid
    );

    const sql = "SELECT * FROM hosp_data where h_address = ?";
    const result = await pool.query(sql, [req.params.pin]);

    res.render("choose_hosp", {
      hospital: result,
      myid: req.params.pid,
      pri: pri[0].priority,
    });
  } catch (err) {
    console.error("Error fetching hospital data for choose_hosp:", err);
    res.status(500).send("Internal Server Error");
  }
});


//Hospital form get request---------------------------------------------------
app.get("/Registerhospital", async (req, res) => {
  try {
    const result = await pool.query("SELECT V_name from vaccine");
    res.render("Registerhospital", {
      pincodes: pincode,
      message: "Enter details to Register",
      color: "success",
      vaccines: result,
    });
  } catch (err) {
    console.error("Error fetching vaccine data for Registerhospital:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Inventory form get request
app.get("/Registerinventory", (req, res) => {
  res.render("Registerinventory", { pincodes: pincode });
});

// Inventory data from profile
app.get("/inventory_data", authController.isLoggedIn, async (req, res) => {
  try {
    if (req.user) {
      const sql =
        "select i.*, s.s_time,s.s_quantity,s_id from inventory i join supplies s on s_inventory = i.i_id join hosp_data h on h.h_id = s.s_hospital where h.h_id = ? order by s.s_time desc;";
      const sql2 =
        "select case when h.h_type = 'P' then v.v_cost*s.s_quantity when h.h_type = 'G' then 0 end as total_cost from hosp_data h join vaccine v on v.v_name = h.h_vac join supplies s on s.s_hospital = h.h_id where h.h_id = ? order by s.s_time desc;";
      const sql3 = "select quant_rem from hospital where h_id = ?;";

      const [resultInventory, resultCost, resultQuantRem] = await Promise.all([
        pool.query(sql, req.user.H_id),
        pool.query(sql2, req.user.H_id),
        pool.query(sql3, req.user.H_id)
      ]);

      res.render("inventory_data", {
        inventory: resultInventory,
        cost: resultCost,
        check: 0,
        quant_rem: resultQuantRem[0].quant_rem,
      });
    } else {
      res.render("hosp_login", {
        message: "",
      });
    }
  } catch (err) {
    console.error("Error fetching data for inventory_data:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Hospital data page after login into profile if cookie exists
app.get("/hospitaldata", authController.isLoggedIn, async (req, res) => {
  console.log("inside");
  console.log(req.user);
  try {
    if (req.user) {
      const sql1 =
        "select count(*) as count from vaccinates where hosp = ? and date_first is not null;";
      const resultCount = await pool.query(sql1, req.user.H_id);
      const count = resultCount[0].count;

      const sql =
        "select i.*, s.s_time,s.s_quantity from inventory i join supplies s on s_inventory = i.i_id join hosp_data h on h.h_id = s.s_hospital where h.h_id = ? order by s.s_time desc;";
      const inventDetails = await pool.query(sql, req.user.H_id);

      const sql2 = "select * from inventory;";
      const inv = await pool.query(sql2, req.user.H_id);

      res.render("hospitaldata", {
        user: req.user,
        invent_details: inventDetails[0],
        count: count,
        inv: inv,
      });
    } else {
      res.render("hosp_login", {
        message: "",
      });
    }
  } catch (err) {
    console.error("Error fetching data for hospitaldata:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Handle logout request
app.get("/logout", authController.logout);

// Handle hospital login page request
app.get("/hosp_login", (req, res) => {
  res.render("hosp_login", { message: "" });
});

// Hospital patient data page request
app.get("/hosp_logindata", authController.isLoggedIn, async (req, res) => {
  try {
    if (req.user) {
      const sql1 = "call filter_patients(4, ?);";
      const result = await pool.query(sql1, req.user.H_id);

      res.render("hosp_logindata", {
        user: req.user,
        patients: result[0],
      });
    } else {
      res.render("hosp_login", {
        message: "",
      });
    }
  } catch (err) {
    console.error("Error fetching data for hosp_logindata:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Handle ONE DOSE in patient page in hospital profile request
app.get("/onedose", authController.isLoggedIn, (req, res) => {
  try {
    if (req.user) {
      let sql1 = "call filter_patients(1, ?);";
      pool.query(sql1, req.user.H_id, function (err, result) {
        if (err) throw err;
        res.render("hosp_logindata", {
          user: req.user,
          patient_details: result,
          message: "One dose administered",
          check: 0,
        });
      });
    } else {
      res.render("hosp_login", {
        message: "",
      });
    }
  } catch (err) {
    console.error("Error fetching ONE DOSE patient data:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Handle No DOSE in patient page in hospital profile request
app.get("/nodose", authController.isLoggedIn, (req, res) => {
  try {
    if (req.user) {
      let sql1 = "call filter_patients(3, ?);";
      pool.query(sql1, req.user.H_id, function (err, result) {
        if (err) throw err;
        res.render("hosp_logindata", {
          user: req.user,
          patient_details: result,
          message: "No dose administered",
          check: 0,
        });
      });
    } else {
      res.render("hosp_login", {
        message: "",
      });
    }
  } catch (err) {
    console.error("Error fetching No DOSE patient data:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Handle BOTH DOSE in patient page in hospital profile request
app.get("/bothdose", authController.isLoggedIn, (req, res) => {
  try {
    if (req.user) {
      let sql1 = "call filter_patients(2, ?);";
      pool.query(sql1, req.user.H_id, function (err, result) {
        if (err) throw err;
        res.render("hosp_logindata", {
          user: req.user,
          patient_details: result,
          message: "Both dose administered",
          check: 0,
        });
      });
    } else {
      res.render("hosp_login", {
        message: "",
      });
    }
  } catch (err) {
    console.error("Error fetching BOTH DOSE patient data:", err);
    res.status(500).send("Internal Server Error");
  }
});

/************************POST REQUESTS*******************************/
/********************************************************************/

// Add error handling to POST requests


//Deletes records from supplies table from inventory page
app.post("/delete", authController.isLoggedIn, (req, res) => {
  try {
  if (req.user) {
    let sql = "delete FROM supplies where S_id = ? and S_hospital = ?";
    pool.query(sql, [req.body.checkbox, req.user.H_id], (err, result) => {
      if (err) throw err;
      res.redirect("/inventory_data");
    });
  } else {
    res.redirect("/");
  }
} catch (err) {
  console.error("Error handling patient registration:", err);
  res.status(500).send("Internal Server Error");
}
});

// Patient registration post request
app.post("/patient", (req, res) => {
  try {
    const val = [
      req.body.inputName,
      req.body.inputEmail,
      req.body.inputPIN,
      req.body.inputDOB,
      req.body.contact,
      req.body.optradio,
    ];
  
    let sql =
      "INSERT INTO person (p_name,p_email,p_address,p_dob,p_contactno,p_gender) VALUES (?)";
    pool.query(sql, [val], function (err, result) {
      if (err) throw err;
      console.log(result);
      const pid = result.insertId;
      console.log(
        "Number of records inserted in patient: " + result.affectedRows
      );
      res.redirect("/choose_hosp/" + req.body.inputPIN + "/" + pid);
    });
  } catch (err) {
    console.error("Error handling patient registration:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Choosing hospital during patient registration
app.post("/choose_hosp/:id", (req, res) => {
  try {
    const hosp_name = req.body.inputHOSP;
    var sql2 = "SELECT * from hosp_data where H_name = (?)";
    pool.query(sql2, [hosp_name], function (err, result) {
      if (err) throw err;
      if (result.length === 0) {
        pool.query(
          "delete from person where p_id not in (select p from vaccinates);",
          function (err, result) {
            if (err) throw err;
            console.log("No of deleted data: " + result.affectedRows);
          }
        );
      } else {
        const hosp_id = result[0].H_id;
        const p_id = req.params.id;
        const values = [p_id, hosp_id];
        pool.query(
          "INSERT INTO vaccinates (P, Hosp) VALUES (?)",
          [values],
          function (err, result) {
            if (err) throw err;
            console.log(
              "Number of records inserted in vaccinates: " + result.affectedRows
            );
            pool.query(
              "delete from person where p_id not in (select p from vaccinates);",
              function (err, result) {
                if (err) throw err;
                console.log("No of deleted data: " + result.affectedRows);
              }
            );
          }
        );
      }
  
      return res.redirect("/");
    });
  } catch (err) {
    console.error("Error choosing hospital during patient registration:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Hospital signup page post request
app.post("/Registerhospital", (req, res) => {
  try {
    console.log(req.body);

    const name = req.body.inputName;
    const email = req.body.inputEmail;
    const contact = req.body.inputContact;
    const htype = req.body.inputhospitaltype;
    const pwd = req.body.inputPassword;
    const repwd = req.body.reinputPassword;
    const pin = req.body.inputPIN;
    const vacc = req.body.inputVACC;
  
    console.log(pin);
    pool.query(
      "SELECT h_email from hosp_data WHERE h_email = ?",
      [email],
      async (err, results) => {
        if (err) {
          throw err;
        }
        if (results.length > 0) {
          return res.render("Registerhospital", {
            pincodes: pincode,
            message:
              "Please Note That: That email has already been registered! Kindly headover to the login page",
            color: "danger",
            vaccines: vaccine,
          });
        } else if (pwd !== repwd) {
          return res.render("Registerhospital", {
            pincodes: pincode,
            message: "Please Note That: Passwords do not match!",
            color: "danger",
            vaccines: vaccine,
          });
        }
  
        let hashedPassword = await bcrypt.hash(pwd, 8);
        console.log(hashedPassword);
  
        pool.query(
          "INSERT INTO hospital SET ?",
          {
            h_name: name,
            h_email: email,
            h_contactno: contact,
            h_type: htype,
            h_address: pin,
            h_pwd: hashedPassword,
            h_vac: vacc,
            quant_rem: 0,
          },
          function (err, result) {
            if (err) throw err;
            console.log(
              "Number of records inserted in hospital: " + result.affectedRows
            );
            return res.render("Registerhospital", {
              pincodes: pincode,
              message:
                "Success! Your Hospital has been registered. Please login to continue.",
              color: "success",
              vaccines: vaccine,
            });
          }
        );
      }
    );
  } catch (err) {
    console.error("Error handling hospital signup:", err);
    res.status(500).send("Internal Server Error");
  }
});

//Hospital login page post request-------------------------------------------------------
app.post("/hospital_login", async (req, res) => {
  try {
    console.log(req.body);
    const email = req.body.hospid;
    const pwd = req.body.hospwd;
    pool.query(
      "SELECT * from hospital WHERE h_email = ?",
      [email],
      async (err, results) => {
        console.log("Results :", results);

        if (results.length === 0) {
          res.status(401).render("hosp_login", {
            message: "Error: Account not found.",
          });
        } else if (!(await bcrypt.compare(pwd, results[0].H_pwd))) {
          res.status(401).render("hosp_login", {
            message: "Error: Email or password does not match.",
          });
        } else {
          const id = results[0].H_id;
          console.log("id :" + id);
          const token = jwt.sign({ id }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN,
          });

          const expirationDate = new Date();
          expirationDate.setTime(
            expirationDate.getTime() + 24 * 60 * 60 * 1000
          ); // Set the expiration time to 24 hours from now

          const cookieOptions = {
            expires: expirationDate,
            httpOnly: true,
          };
          res.cookie("jwt", token, cookieOptions);
          res.status(200).redirect("/hospitaldata");
        }
      }
    );
  } catch (error) {
    console.log(error);
  }
});

// Register inventory post request
app.post("/Registerinventory", (req, res) => {
  try {
    const val = [
      req.body.inputName,
      req.body.inputContact,
      req.body.PINinventory,
    ];
    let sql = "INSERT INTO inventory (I_name,I_contactno,I_address) VALUES (?)";
    pool.query(sql, [val], function (err, result) {
      if (err) throw err;
      console.log("Number of records inserted: " + result.affectedRows);
      res.redirect("/");
    });
  } catch (err) {
    console.error("Error handling inventory registration:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Inventory data post request
app.post("/inventory_data", authController.isLoggedIn, (req, res) => {
  try {
    if (req.user) {
      const val = [req.user.H_id, req.body.id, req.body.quantity, req.body.date];
  
      let sqlcheck = "SELECT I_id from inventory where I_id=?";
      pool.query(sqlcheck, [req.body.id], (err, result) => {
        if (err) throw err;
        if (result.length === 0) {
          let sql =
            "select i.*, s.s_time,s.s_quantity,s_id from inventory i join supplies s on s_inventory = i.i_id join hosp_data h on h.h_id = s.s_hospital where h.h_id = ? order by s.s_time desc;";
          let sql2 =
            "select case when h.h_type = 'P' then v.v_cost*s.s_quantity when h.h_type = 'G' then 0 end as total_cost from hosp_data h join vaccine v on v.v_name = h.h_vac join supplies s on s.s_hospital = h.h_id where h.h_id = ? order by s.s_time desc;";
          let sql3 = "select quant_rem from hospital where h_id = ?;";
          pool.query(sql, req.user.H_id, function (err, result) {
            if (err) throw err;
            const invent_details = result;
            pool.query(sql2, req.user.H_id, function (err, result) {
              if (err) throw err;
              const cost = result;
              pool.query(sql3, req.user.H_id, function (err, result) {
                if (err) throw error;
                res.render("inventory_data", {
                  inventory: invent_details,
                  cost: cost,
                  check: 1,
                  quant_rem: result[0].quant_rem,
                });
              });
            });
          });
        } else {
          let sql3 =
            "INSERT INTO supplies (S_hospital,S_inventory,S_quantity,S_time) VALUES (?)";
          pool.query(sql3, [val], function (err, result) {
            if (err) throw err;
            console.log(
              "Number of records inserted in inventory: " + result.affectedRows
            );
            res.redirect("/inventory_data");
          });
        }
      });
    } else {
      res.render("hosp_login", {
        message: "",
      });
    }
  } catch (err) {
    console.error("Error handling inventory data:", err);
    res.status(500).send("Internal Server Error");
  }
});




// Handle hospital patient data page request
app.post("/hosp_logindata", authController.isLoggedIn, (req, res) => {
  try {
    if (req.user) {
      console.log(req.body);
      const dose1 = req.body.dose1 || null;
      const dose2 = req.body.dose2 || null;
      const val = [dose1, dose2, req.user.H_id, req.body.id];
      let sqlcheck = "SELECT quant_rem FROM Hospital WHERE H_id=?";
      let flag;
      pool.query(sqlcheck, [req.user.H_id], (err, result) => {
        if (err) throw err;
        const quantity = result[0].quant_rem;
        if (dose1 !== "" && dose2 === "" && quantity >= 1) {
          flag = 1;
        } else if (dose1 !== "" && dose2 !== "" && quantity >= 1) {
          flag = 1;
        } else {
          flag = 0;
        }
        console.log(flag);
        if (flag === 1) {
          let sql4 =
            "Update vaccinates SET Date_first =?, Date_second =? where Hosp =? and P =?";
          pool.query(sql4, val, function (err, result) {
            if (err) {
              console.error(err);
              let sql1 = "call filter_patients(4,?);";
              pool.query(sql1, req.user.H_id, function (err, result) {
                if (err) throw err;
                res.render("hosp_logindata", {
                  user: req.user,
                  patient_details: result,
                  message: "All records",
                  check: 1,
                });
              });
              return;
            }
            console.log("Number of records updated: " + result.affectedRows);
            if (result.affectedRows === 0) {
              let sql1 =
                "select * from person p join vaccinates v on v.P = p.p_id join hosp_data h on v.hosp = h.h_id where h.h_id =?;";
              pool.query(sql1, req.user.H_id, function (err, result) {
                if (err) throw err;
                res.render("hosp_logindata", {
                  user: req.user,
                  patient_details: result,
                  message: "All records",
                  check: 1,
                });
              });
            } else {
              res.redirect("/hosp_logindata");
            }
          });
        } else {
          let sql1 =
            "select * from person p join vaccinates v on v.P = p.p_id join hosp_data h on v.hosp = h.h_id where h.h_id =?;";
          pool.query(sql1, req.user.H_id, function (err, result) {
            if (err) throw err;
            res.render("hosp_logindata", {
              user: req.user,
              patient_details: result,
              message: "All records",
              check: 1,
            });
          });
        }
      });
    } else {
      res.render("hosp_login", {
        message: "",
      });
    }
  } catch (err) {
    console.error("Error handling hospital patient data:", err);
    res.status(500).send("Internal Server Error");
  }
});




/***************************LISTEN PORT******************************/
/********************************************************************/

app.listen(3001, function () {
  console.log("Server is running on port http://localhost:3001");
})